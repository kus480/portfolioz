(() => {
  "use strict";

  const config = window.PORTFOLIO_CONFIG;
  const apiBaseUrl = config.apiBaseUrl.replace(/\/$/, "");
  const endpoints = config.endpoints;
  const browserStates = new WeakMap();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const dialog = document.querySelector(".artwork-dialog");
  const dialogImage = dialog.querySelector(".dialog-image");
  const randomGrid = document.querySelector("[data-random-grid]");
  const fallbackOverlay = document.querySelector(".image-fullscreen-fallback");
  const hero = document.querySelector(".hero");
  const backToTop = document.querySelector(".back-to-top");
  let slideWorks = [];
  let slideIndex = 0;
  let galleryWorks = [];
  let galleryIndex = 0;
  let allWorksPromise;
  let scrollFrame = 0;
  let lockedScrollY = null;
  let galleryAnimating = false;

  function toRecord(entry) {
    if (!entry || typeof entry !== "object") return {};
    if (!entry.attributes || typeof entry.attributes !== "object") return entry;
    return { id: entry.id, documentId: entry.documentId, ...entry.attributes };
  }

  function getRecords(payload) {
    const data = payload?.data;
    return Array.isArray(data) ? data.map(toRecord) : data ? [toRecord(data)] : [];
  }

  function getMediaUrl(media) {
    if (Array.isArray(media)) media = media[0];
    const record = getRelations(media)[0] || {};
    const url = record.url || record.formats?.large?.url || record.formats?.medium?.url || record.formats?.thumbnail?.url;
    if (!url) return "";
    return url.startsWith("http") ? url : `${apiBaseUrl.replace(/\/api$/, "")}${url}`;
  }

  function getRelations(value) {
    if (Array.isArray(value)) return value.map(toRecord);
    if (value && Object.prototype.hasOwnProperty.call(value, "data")) {
      const data = value.data;
      return Array.isArray(data) ? data.map(toRecord) : data ? [toRecord(data)] : [];
    }
    return value && typeof value === "object" ? [toRecord(value)] : [];
  }

  function getName(record) {
    return record.Name || record.name || record.title || record.slug || "";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function safeRichTextUrl(value, baseUrl, protocols) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value.trim(), baseUrl);
      if (protocols.includes(url.protocol)) return url.href;
    } catch (error) {
      console.warn("Некорректный адрес в описании работы.", error);
      return "";
    }
    console.warn("Недопустимый протокол ссылки в описании работы.");
    return "";
  }

  function renderRichTextNode(node) {
    if (!node || typeof node !== "object") {
      console.warn("Некорректный блок в описании работы.", node);
      return "";
    }

    if (node.type === "text") {
      let text = escapeHtml(node.text ?? "");
      if (!text) return "";
      [
        ["bold", "strong"],
        ["italic", "em"],
        ["underline", "u"],
        ["strikethrough", "s"],
        ["code", "code"],
      ].forEach(([modifier, tag]) => {
        if (node[modifier]) text = `<${tag}>${text}</${tag}>`;
      });
      return text;
    }

    const children = Array.isArray(node.children)
      ? node.children.map(renderRichTextNode).join("")
      : "";

    switch (node.type) {
      case "paragraph":
        return `<p>${children || "<br>"}</p>`;
      case "heading": {
        const level = Number(node.level);
        if (!Number.isInteger(level) || level < 1 || level > 6) {
          console.warn("Некорректный уровень заголовка в описании работы.", node.level);
          return `<p>${children || "<br>"}</p>`;
        }
        return `<h${level}>${children}</h${level}>`;
      }
      case "list": {
        if (node.format !== "ordered" && node.format !== "unordered") {
          console.warn("Неизвестный формат списка в описании работы.", node.format);
        }
        const tag = node.format === "ordered" ? "ol" : "ul";
        return `<${tag}>${children}</${tag}>`;
      }
      case "list-item":
        return `<li>${children}</li>`;
      case "quote":
        return `<blockquote>${children}</blockquote>`;
      case "code":
        return `<pre><code>${children}</code></pre>`;
      case "link": {
        const href = safeRichTextUrl(node.url, window.location.href, ["http:", "https:", "mailto:", "tel:"]);
        return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${children}</a>` : children;
      }
      case "image": {
        const image = node.image || {};
        const src = safeRichTextUrl(image.url, `${apiBaseUrl.replace(/\/api$/, "")}/`, ["http:", "https:"]);
        if (!src) return "";
        const alt = escapeHtml(image.alternativeText || "");
        const caption = image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : "";
        return `<figure><img src="${escapeHtml(src)}" alt="${alt}" loading="lazy">${caption}</figure>`;
      }
      default:
        console.warn("Неизвестный тип блока в описании работы.", node.type);
        return children;
    }
  }

  function renderRichText(value) {
    if (Array.isArray(value) && value.length) {
      return value.map(renderRichTextNode).join("");
    }
    if (typeof value === "string" && value.trim()) {
      return `<p>${escapeHtml(value)}</p>`;
    }
    if (value != null && !Array.isArray(value) && typeof value !== "string") {
      console.warn("Некорректное описание работы.", value);
    }
    return "<p>Описание пока не добавлено.</p>";
  }

  function normalizeName(value) {
    return String(value).trim().toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
  }

  function toArtwork(entry) {
    const artwork = toRecord(entry);
    const image = getRelations(artwork.image)[0] || {};
    return {
      id: artwork.id,
      title: artwork.title || artwork.name || "Без названия",
      price: artwork.price,
      description: artwork.description,
      imageUrl: getMediaUrl(artwork.image || artwork.cover),
      imageAlt: image.alternativeText || artwork.title || "Авторская работа",
      tags: getRelations(artwork.tags).map((tag) => ({
        id: tag.id,
        name: getName(tag),
        slug: tag.slug || "",
      })),
    };
  }

  function formatPrice(price) {
    if (price === null || price === undefined || price === "") return "Цена по запросу";
    const numericPrice = typeof price === "number" ? price : Number(String(price).replace(/\s|₽|руб\.?/gi, "").replace(",", "."));
    if (Number.isFinite(numericPrice)) {
      return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(numericPrice);
    }
    return String(price);
  }

  function makeUrl(endpoint, params = {}) {
    const url = new URL(`${apiBaseUrl}/${endpoint}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return url;
  }

  async function fetchCollection(endpoint, params = {}) {
    const response = await fetch(makeUrl(endpoint, params));
    if (!response.ok) {
      throw new Error(`Strapi вернул ошибку ${response.status} для «${endpoint}».`);
    }
    return response.json();
  }

  async function fetchCategories() {
    const [categoryResult, subcategoryResult] = await Promise.all([
      fetchCollection(endpoints.categories, { populate: "*", "pagination[pageSize]": "100" }),
      fetchCollection(endpoints.subcategories, { populate: "*", "pagination[pageSize]": "100" }),
    ]);
    const categories = getRecords(categoryResult);
    const allSubcategories = getRecords(subcategoryResult);

    document.querySelectorAll(".category-browser").forEach((browser) => {
      const section = browser.dataset.section;
      const configuredSlug = config.categorySlugs?.[section];
      const category = categories.find((record) => record.slug === configuredSlug)
        || categories.find((record) => {
          const name = normalizeName(getName(record));
          return section === "paintings"
            ? name.includes("картин") || name.includes("painting")
            : name.includes("декор") || name.includes("покрыт") || name.includes("роспис");
        });
      if (!category) {
        browser.dataset.categoryUnavailable = "true";
        return;
      }

      const relatedSubcategories = getRelations(category.subcategories);
      const relatedIds = new Set(relatedSubcategories.map((entry) => String(entry.documentId || entry.id)));
      const expectedNames = new Set(
        Array.from(browser.querySelectorAll("[data-subcategory-name]"))
          .map((button) => normalizeName(button.dataset.subcategoryName)),
      );
      const subcategories = relatedIds.size
        ? allSubcategories.filter((entry) => relatedIds.has(String(entry.documentId || entry.id)))
        : allSubcategories.filter((entry) => {
          const owner = getRelations(entry.category)[0];
          const belongsToCategory = owner
            ? String(owner.documentId || owner.id) === String(category.documentId || category.id)
            : expectedNames.has(normalizeName(getName(entry)));
          return belongsToCategory && expectedNames.has(normalizeName(getName(entry)));
        });

      browser.querySelectorAll("[data-subcategory-name]").forEach((button) => {
        const requestedName = normalizeName(button.dataset.subcategoryName);
        const subcategory = subcategories.find((entry) => normalizeName(getName(entry)) === requestedName);
        if (subcategory) {
          button.dataset.subcategoryId = String(subcategory.id ?? subcategory.documentId ?? "");
          button.dataset.subcategorySlug = subcategory.slug || "";
          button.textContent = getName(subcategory);
        }
      });
    });
    return categories;
  }

  async function fetchSubcategoryContent(subcategoryId) {
    const result = await fetchCollection(endpoints.subcategories, {
      "filters[id][$eq]": String(subcategoryId),
      "populate[tags]": "*",
      "populate[works][populate]": "*",
    });
    const subcategory = getRecords(result)[0];
    if (!subcategory) {
      throw new Error(`Strapi не вернул подкатегорию с ID ${subcategoryId}.`);
    }

    return {
      tags: getRelations(subcategory.tags)
        .map((tag) => ({ ...tag, name: getName(tag) }))
        .sort((first, second) => first.name.localeCompare(second.name, "ru")),
      works: getRelations(subcategory.works).map(toArtwork),
    };
  }

  async function fetchWorksForTag(tag, subcategoryId, subcategoryWorks) {
    const relatedWorks = subcategoryWorks.filter((work) =>
      getRelations(work.tags).some((workTag) =>
        String(workTag.id ?? workTag.documentId) === String(tag.id ?? tag.documentId)
          || (tag.slug && workTag.slug === tag.slug),
      ),
    );
    if (relatedWorks.length) return relatedWorks;

    const result = await fetchCollection(endpoints.works, {
      "filters[tags][id][$eq]": String(tag.id),
      "filters[subcategories][id][$eq]": String(subcategoryId),
      "populate[image]": "*",
      "populate[tags]": "*",
      "pagination[pageSize]": "100",
    });
    return getRecords(result).map(toArtwork);
  }

  async function fetchAllWorks() {
    if (!allWorksPromise) {
      allWorksPromise = (async () => {
        const params = {
          populate: "*",
          "pagination[pageSize]": "100",
          "pagination[page]": "1",
          "sort[0]": "publishedAt:desc",
        };
        const firstPage = await fetchCollection(endpoints.works, params);
        const records = getRecords(firstPage);
        const pageCount = firstPage.meta?.pagination?.pageCount || 1;
        const remainingPages = await Promise.all(
          Array.from({ length: pageCount - 1 }, (_, index) =>
            fetchCollection(endpoints.works, { ...params, "pagination[page]": String(index + 2) })),
        );
        remainingPages.forEach((page) => records.push(...getRecords(page)));
        return records;
      })().catch((error) => {
        allWorksPromise = undefined;
        throw error;
      });
    }
    return allWorksPromise;
  }

  async function fetchGalleryWorks() {
    return (await fetchAllWorks()).map(toArtwork);
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function showPanel(panel, content) {
    panel.dataset.transitionToken = String((Number(panel.dataset.transitionToken) || 0) + 1);
    panel.replaceChildren(content);
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add("is-visible"));
  }

  function hidePanel(panel) {
    const token = (Number(panel.dataset.transitionToken) || 0) + 1;
    panel.dataset.transitionToken = String(token);
    panel.classList.remove("is-visible");
    window.setTimeout(() => {
      if (panel.dataset.transitionToken !== String(token) || panel.classList.contains("is-visible")) return;
      panel.hidden = true;
      panel.replaceChildren();
    }, reducedMotion.matches ? 0 : 240);
  }

  function makeStatus(text, isError = false) {
    const status = makeElement("p", `status-message${isError ? " is-error" : ""}`, text);
    status.setAttribute("role", isError ? "alert" : "status");
    return status;
  }

  function artworkCard(artwork, contextWorks = [artwork]) {
    const card = makeElement("article", "artwork-card");
    const openButton = makeElement("button", "artwork-card-open");
    openButton.type = "button";
    openButton.setAttribute("aria-label", `Посмотреть работу: ${artwork.title}`);

    const imageWrap = makeElement("span", "artwork-card-image");
    if (artwork.imageUrl) {
      const image = makeElement("img");
      image.src = artwork.imageUrl;
      image.alt = artwork.imageAlt;
      image.loading = "lazy";
      imageWrap.append(image);
    } else {
      imageWrap.classList.add("image-placeholder");
      imageWrap.setAttribute("aria-label", "Изображение будет добавлено");
    }

    const content = makeElement("span", "artwork-card-content");
    const meta = makeElement("span", "artwork-card-meta");
    const title = makeElement("span", "artwork-card-title", artwork.title);
    const tags = makeElement("span", "artwork-card-tags");
    artwork.tags.forEach((tag) => tags.append(makeElement("span", "mini-tag", tag.name)));
    meta.append(title, tags);
    content.append(meta);
    openButton.append(imageWrap, content);

    const fullscreenButton = makeElement("button", "artwork-card-fullscreen", "⛶");
    fullscreenButton.type = "button";
    fullscreenButton.setAttribute("aria-label", `Развернуть работу «${artwork.title}» на весь экран`);
    fullscreenButton.title = "На весь экран";
    fullscreenButton.addEventListener("click", () => showArtworkFullscreen(artwork));

    card.append(openButton, fullscreenButton);
    openButton.addEventListener("click", () => openArtwork(artwork, contextWorks));
    return card;
  }

  function renderRandomWorks(works) {
    randomGrid.replaceChildren();
    if (!works.length) {
      randomGrid.append(makeStatus("Пока нет опубликованных работ."));
      document.querySelector(".random-previous").disabled = true;
      document.querySelector(".random-next").disabled = true;
      return;
    }
    galleryIndex = (galleryIndex + works.length) % works.length;
    const visibleCount = window.matchMedia("(max-width: 800px)").matches ? 1 : Math.min(2, works.length);
    for (let offset = 0; offset < visibleCount; offset += 1) {
      randomGrid.append(artworkCard(works[(galleryIndex + offset) % works.length], works));
    }
    document.querySelector(".random-previous").disabled = works.length < 2;
    document.querySelector(".random-next").disabled = works.length < 2;
  }

  function moveRandomWork(direction) {
    if (galleryWorks.length < 2 || galleryAnimating) return;
    if (
      window.matchMedia("(max-width: 800px)").matches
      || reducedMotion.matches
      || randomGrid.querySelectorAll(".artwork-card").length < 2
    ) {
      galleryIndex = (galleryIndex + direction + galleryWorks.length) % galleryWorks.length;
      renderRandomWorks(galleryWorks);
      return;
    }

    const cards = Array.from(randomGrid.querySelectorAll(".artwork-card"));
    const leftCard = cards[0];
    const rightCard = cards[1];
    const enteringIndex = direction > 0
      ? (galleryIndex + 2) % galleryWorks.length
      : (galleryIndex - 1 + galleryWorks.length) % galleryWorks.length;
    const enteringCard = artworkCard(galleryWorks[enteringIndex], galleryWorks);
    const enteringClass = direction > 0 ? "carousel-enter-right" : "carousel-enter-left";
    enteringCard.classList.add(enteringClass);
    randomGrid.append(enteringCard);
    galleryAnimating = true;

    if (direction > 0) {
      leftCard.classList.add("carousel-exit-left");
      rightCard.classList.add("carousel-shift-left");
    } else {
      leftCard.classList.add("carousel-shift-right");
      rightCard.classList.add("carousel-exit-right");
    }

    requestAnimationFrame(() => {
      enteringCard.classList.add("carousel-enter-active");
      window.setTimeout(() => {
        [leftCard, rightCard, enteringCard].forEach((card) => {
          card.style.transition = "none";
        });
        if (direction > 0) {
          leftCard.remove();
        } else {
          rightCard.remove();
          randomGrid.insertBefore(enteringCard, leftCard);
        }
        [leftCard, rightCard, enteringCard].forEach((card) => {
          card.classList.remove(
            "carousel-exit-left",
            "carousel-shift-left",
            "carousel-exit-right",
            "carousel-shift-right",
            "carousel-enter-left",
            "carousel-enter-right",
            "carousel-enter-active",
          );
        });
        randomGrid.offsetHeight;
        requestAnimationFrame(() => {
          [leftCard, rightCard, enteringCard].forEach((card) => {
            card.style.removeProperty("transition");
          });
        });
        galleryIndex = (galleryIndex + direction + galleryWorks.length) % galleryWorks.length;
        galleryAnimating = false;
      }, 520);
    });
  }

  function renderTags(browser) {
    const tagPanel = browser.querySelector(".tag-panel");
    const workPanel = browser.querySelector(".work-panel");
    const state = browserStates.get(browser);
    if (!state) return;
    const content = document.createElement("div");
    content.className = "tag-panel-content";
    const activeTab = browser.querySelector(".tab-button.is-active");
    const heading = makeElement("p", "panel-caption", `Теги: ${activeTab?.textContent || "Категория"}`);
    const tagList = makeElement("div", "tag-list");
    if (!state.tags.length) {
      tagList.append(makeStatus(
        "У этой подкатегории нет связанных тегов. В Strapi откройте подкатегорию, заполните поле «Tags» и опубликуйте изменения.",
      ));
    } else {
      state.tags.forEach((tag) => {
        const button = makeElement("button", "tag-button", getName(tag));
        button.type = "button";
        const relatedWork = state.works.find((work) => work.tags.some((workTag) => {
          const sameId = tag.id != null && workTag.id != null
            && String(tag.id) === String(workTag.id);
          const sameDocumentId = tag.documentId && workTag.documentId
            && tag.documentId === workTag.documentId;
          return sameId || sameDocumentId
            || (tag.slug && workTag.slug === tag.slug)
            || normalizeName(workTag.name) === normalizeName(getName(tag));
        }));
        if (relatedWork?.imageUrl) {
          button.classList.add("has-background");
          const background = makeElement("span", "tag-button-background");
          background.setAttribute("aria-hidden", "true");
          const image = makeElement("img");
          image.src = relatedWork.imageUrl;
          image.alt = "";
          image.loading = "lazy";
          background.append(image);
          button.replaceChildren(background, makeElement("span", "tag-button-label", getName(tag)));
        }
        button.addEventListener("click", () => selectTag(browser, tag));
        tagList.append(button);
      });
    }
    content.append(heading, tagList);
    hidePanel(workPanel);
    showPanel(tagPanel, content);
  }

  async function selectTag(browser, tag) {
    const tagPanel = browser.querySelector(".tag-panel");
    const workPanel = browser.querySelector(".work-panel");
    const state = browserStates.get(browser);
    if (!state) return;
    const requestId = String((Number(browser.dataset.tagRequestId) || 0) + 1);
    browser.dataset.tagRequestId = requestId;
    const content = document.createElement("div");
    content.className = "work-panel-content";
    const controls = makeElement("div", "work-panel-heading");
    const back = makeElement("button", "text-button", "← Все теги");
    back.type = "button";
    back.addEventListener("click", () => {
      renderTags(browser);
      hidePanel(workPanel);
    });
    controls.append(back, makeElement("p", "panel-caption", getName(tag)));
    const grid = makeElement("div", "artwork-grid");
    grid.append(makeStatus("Загружаем работы…"));
    content.append(controls, grid);

    hidePanel(tagPanel);
    showPanel(workPanel, content);

    try {
      const works = await fetchWorksForTag(tag, state.subcategoryId, state.works);
      if (browser.dataset.tagRequestId !== requestId) return;
      state.filteredWorks = works;
      grid.replaceChildren();
      if (!works.length) {
        grid.append(makeStatus("Пока нет работ по этому тегу."));
        return;
      }
      works.forEach((work) => {
        grid.append(artworkCard(work, works));
      });
    } catch (error) {
      if (browser.dataset.tagRequestId !== requestId) return;
      console.error(error);
      grid.replaceChildren(makeStatus("Не удалось загрузить работы. Проверьте соединение со Strapi.", true));
    }
  }

  function activateTab(browser, selectedButton) {
    const tagPanel = browser.querySelector(".tag-panel");
    const workPanel = browser.querySelector(".work-panel");
    browser.querySelectorAll(".tab-button").forEach((button) => {
      const selected = button === selectedButton;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", String(selected));
    });

    const content = document.createElement("div");
    content.className = "tag-panel-content";
    content.append(makeStatus("Загружаем теги…"));
    hidePanel(workPanel);
    showPanel(tagPanel, content);

    if (!selectedButton.dataset.subcategoryId) {
      showPanel(tagPanel, makeStatus("Эта подкатегория не найдена в Strapi. Проверьте разделы «Категории» и «Подкатегории».", true));
      return;
    }

    const requestId = String((Number(browser.dataset.contentRequestId) || 0) + 1);
    browser.dataset.contentRequestId = requestId;
    fetchSubcategoryContent(selectedButton.dataset.subcategoryId)
      .then(({ tags, works }) => {
        if (browser.dataset.contentRequestId !== requestId) return;
        browserStates.set(browser, {
          subcategoryId: selectedButton.dataset.subcategoryId,
          tags,
          works,
          filteredWorks: [],
        });
        renderTags(browser);
      })
      .catch((error) => {
        if (browser.dataset.contentRequestId !== requestId) return;
        console.error(error);
        showPanel(tagPanel, makeStatus("Не удалось загрузить теги. Проверьте соединение со Strapi.", true));
      });
  }

  function setArtwork(artwork) {
    dialogImage.src = artwork.imageUrl || "";
    dialogImage.alt = artwork.imageAlt || artwork.title;
    dialog.querySelector(".dialog-title").textContent = artwork.title;
    dialog.querySelector(".dialog-description").innerHTML = renderRichText(artwork.description);
    const tags = dialog.querySelector(".dialog-tags");
    tags.replaceChildren(...artwork.tags.map((tag) => makeElement("span", "mini-tag", tag.name)));
    dialog.querySelector(".slide-count").textContent = `${slideIndex + 1} / ${slideWorks.length}`;
    const multiple = slideWorks.length > 1;
    dialog.querySelectorAll(".slider-button").forEach((button) => {
      button.hidden = !multiple;
    });
  }

  function openArtwork(artwork, contextWorks) {
    slideWorks = contextWorks.length ? contextWorks : [artwork];
    slideIndex = Math.max(0, slideWorks.findIndex((work) => work.id === artwork.id));
    setArtwork(slideWorks[slideIndex]);
    lockedScrollY = window.scrollY;
    document.documentElement.classList.add("dialog-open");
    document.body.style.setProperty("--dialog-scroll-top", `-${lockedScrollY}px`);
    dialog.showModal();
    document.body.classList.add("dialog-open");
  }

  function moveSlide(direction) {
    if (slideWorks.length < 2) return;
    slideIndex = (slideIndex + direction + slideWorks.length) % slideWorks.length;
    setArtwork(slideWorks[slideIndex]);
  }

  function closeFullscreenFallback() {
    fallbackOverlay.classList.remove("is-open");
    fallbackOverlay.setAttribute("aria-hidden", "true");
    fallbackOverlay.querySelector("img").removeAttribute("src");
    document.body.classList.remove("fullscreen-fallback-open");
    if (document.fullscreenElement === fallbackOverlay) {
      document.exitFullscreen().catch(console.error);
    }
  }

  async function showArtworkFullscreen(artwork) {
    const image = fallbackOverlay.querySelector("img");
    image.src = artwork.imageUrl || "";
    image.alt = artwork.imageAlt || artwork.title;
    fallbackOverlay.classList.add("is-open");
    fallbackOverlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("fullscreen-fallback-open");

    if (fallbackOverlay.requestFullscreen) {
      try {
        await fallbackOverlay.requestFullscreen();
      } catch (error) {
        console.error("Не удалось включить системный полноэкранный режим.", error);
      }
    }
  }

  async function toggleFullscreen() {
    const stage = dialog.querySelector(".artwork-stage");
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (stage.requestFullscreen) {
      try {
        await stage.requestFullscreen();
        return;
      } catch (error) {
        console.error("Не удалось включить системный полноэкранный режим.", error);
      }
    }
    const image = fallbackOverlay.querySelector("img");
    image.src = dialogImage.src;
    image.alt = dialogImage.alt;
    fallbackOverlay.classList.add("is-open");
    fallbackOverlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("fullscreen-fallback-open");
  }

  function setupNavigation() {
    const navbar = document.querySelector(".navbar");
    const scrollToSectionHeading = (section) => {
      const heading = section.querySelector(".section-heading h2, .about-section-title, .contact-title, h2");
      if (!heading || section.id === "home") {
        window.scrollTo({
          top: section.offsetTop,
          behavior: reducedMotion.matches ? "auto" : "smooth",
        });
        return;
      }

      const top = heading.getBoundingClientRect().top + window.scrollY
        - navbar.getBoundingClientRect().height - 12;
      window.scrollTo({
        top: Math.max(0, top),
        behavior: reducedMotion.matches ? "auto" : "smooth",
      });
    };
    const updateScrollEffects = () => {
      const scrollY = window.scrollY;
      const progress = Math.min(scrollY / Math.max(hero.offsetHeight, 1), 1);
      const easedProgress = progress * progress * (3 - 2 * progress);
      const heroShift = easedProgress * (window.innerWidth + hero.offsetWidth + 32);
      const isMobile = window.matchMedia("(max-width: 800px)").matches;
      const brandShift = easedProgress * (isMobile ? 16 : 38);
      hero.style.setProperty("--hero-shift", `${heroShift}px`);
      hero.style.setProperty("--hero-opacity", String(1 - easedProgress));
      navbar.style.setProperty("--nav-shift", "0px");
      navbar.style.setProperty("--brand-shift", `${brandShift}px`);
      backToTop.classList.toggle("is-visible", scrollY >= hero.offsetHeight);
      scrollFrame = 0;
    };
    window.addEventListener("scroll", () => {
      if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScrollEffects);
    }, { passive: true });
    window.addEventListener("resize", () => {
      updateScrollEffects();
      const expectedCardCount = window.matchMedia("(max-width: 800px)").matches
        ? Math.min(1, galleryWorks.length)
        : Math.min(2, galleryWorks.length);
      if (
        !galleryAnimating
        && galleryWorks.length
        && randomGrid.querySelectorAll(".artwork-card").length !== expectedCardCount
      ) {
        renderRandomWorks(galleryWorks);
      }
    });
    updateScrollEffects();

    document.querySelector("[data-scroll-to-gallery]").addEventListener("click", () => {
      scrollToSectionHeading(document.querySelector("#gallery"));
    });
    document.querySelector(".random-previous").addEventListener("click", () => moveRandomWork(-1));
    document.querySelector(".random-next").addEventListener("click", () => moveRandomWork(1));
    backToTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
    });

    const menuToggle = document.querySelector(".menu-toggle");
    const navLinks = document.querySelector(".nav-links");
    menuToggle.addEventListener("click", () => {
      const expanded = menuToggle.getAttribute("aria-expanded") === "true";
      menuToggle.setAttribute("aria-expanded", String(!expanded));
      navLinks.classList.toggle("is-open", !expanded);
    });
    navLinks.addEventListener("click", (event) => {
      const link = event.target.closest("a[href^='#']");
      if (!link) return;
      const target = document.querySelector(link.hash);
      if (!target) return;
      event.preventDefault();
      navLinks.classList.remove("is-open");
      menuToggle.setAttribute("aria-expanded", "false");
      if (window.location.hash !== link.hash) window.history.pushState(null, "", link.hash);
      scrollToSectionHeading(target);
    });
  }

  function setupDialog() {
    dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
    dialog.querySelector(".slider-previous").addEventListener("click", () => moveSlide(-1));
    dialog.querySelector(".slider-next").addEventListener("click", () => moveSlide(1));
    dialog.querySelector(".fullscreen-button").addEventListener("click", toggleFullscreen);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      document.body.classList.remove("dialog-open");
      document.documentElement.classList.remove("dialog-open");
      document.body.style.removeProperty("--dialog-scroll-top");
      if (lockedScrollY !== null) {
        const scrollY = lockedScrollY;
        lockedScrollY = null;
        window.scrollTo(0, scrollY);
      }
      if (document.fullscreenElement) document.exitFullscreen().catch(console.error);
      closeFullscreenFallback();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && fallbackOverlay.classList.contains("is-open")) {
        event.preventDefault();
        closeFullscreenFallback();
        return;
      }
      if (!dialog.open) return;
      if (event.key === "ArrowLeft") moveSlide(-1);
      if (event.key === "ArrowRight") moveSlide(1);
    });
    fallbackOverlay.querySelector(".fallback-close").addEventListener("click", closeFullscreenFallback);
    fallbackOverlay.addEventListener("click", (event) => {
      if (event.target === fallbackOverlay) closeFullscreenFallback();
    });
    document.addEventListener("fullscreenchange", () => {
      dialog.querySelector(".fullscreen-button").setAttribute(
        "aria-label",
        document.fullscreenElement ? "Выйти из полноэкранного режима" : "Развернуть изображение на весь экран",
      );
    });
  }

  function setupBrowsers() {
    document.querySelectorAll(".category-browser").forEach((browser) => {
      browser.querySelectorAll(".tab-button").forEach((button) => {
        button.disabled = true;
        button.addEventListener("click", () => activateTab(browser, button));
      });
    });
  }

  async function initialize() {
    setupNavigation();
    setupDialog();
    setupBrowsers();

    const randomRequest = fetchGalleryWorks()
      .then((works) => {
        galleryWorks = works;
        renderRandomWorks(works);
      })
      .catch((error) => {
        console.error(error);
        randomGrid.replaceChildren(makeStatus("Не удалось загрузить работы. Проверьте адрес Strapi и доступность API.", true));
      });
    const categoriesRequest = fetchCategories().catch((error) => {
      console.error(error);
      document.querySelectorAll(".category-browser").forEach((browser) => {
        browser.dataset.categoriesUnavailable = "true";
      });
    }).finally(() => {
      document.querySelectorAll(".category-browser .tab-button").forEach((button) => {
        button.disabled = false;
      });
    });
    await Promise.all([randomRequest, categoriesRequest]);
  }

  initialize();
})();

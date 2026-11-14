# 🚀 Getting started with Strapi

Strapi comes with a full featured [Command Line Interface](https://docs.strapi.io/dev-docs/cli) (CLI) which lets you scaffold and manage your project in seconds.

### `develop`

Start your Strapi application with autoReload enabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-develop)

```
npm run develop
# or
yarn develop
```

### `start`

Start your Strapi application with autoReload disabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-start)

```
npm run start
# or
yarn start
```

### `build`

Build your admin panel. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-build)

```
npm run build
# or
yarn build
```

## ⚙️ Deployment

Strapi gives you many possible deployment options for your project including [Strapi Cloud](https://cloud.strapi.io). Browse the [deployment section of the documentation](https://docs.strapi.io/dev-docs/deployment) to find the best solution for your use case.

```
yarn strapi deploy
```

### Amvera with persistent `/data`

Configure the backend service to use Node.js 18–22 and mount persistent storage at `/data`. Set `DATABASE_CLIENT=sqlite` and `DATABASE_FILENAME=/data/data.db`. The `start` script copies any existing files missing from `public/uploads` to `/data/uploads`, then replaces `public/uploads` with a symlink to the persistent directory before starting Strapi.

If files with the same name have different contents, startup stops without deleting the original uploads; resolve the conflict before retrying. Existing local SQLite data and ignored media are not deployed by Git: back up and transfer the database and its matching uploads to `/data` separately before the first production start.

Copy the variables from your local `backend/.env` into the Amvera service settings. Keep `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, and `JWT_SECRET` private and preserve their existing values. Set `HOST=0.0.0.0`; use the port configured or provided by Amvera. `DATABASE_FILENAME` defaults to `.tmp/data.db` locally.

The CORS middleware currently permits every origin and the standard HTTP methods. Strapi 4 requires the string `'*'` for a wildcard; `['*']` is treated as an exact origin list. Restrict `origin` to the frontend domain for production if the API should not be accessible from arbitrary websites.

## 📚 Learn more

- [Resource center](https://strapi.io/resource-center) - Strapi resource center.
- [Strapi documentation](https://docs.strapi.io) - Official Strapi documentation.
- [Strapi tutorials](https://strapi.io/tutorials) - List of tutorials made by the core team and the community.
- [Strapi blog](https://strapi.io/blog) - Official Strapi blog containing articles made by the Strapi team and the community.
- [Changelog](https://strapi.io/changelog) - Find out about the Strapi product updates, new features and general improvements.

Feel free to check out the [Strapi GitHub repository](https://github.com/strapi/strapi). Your feedback and contributions are welcome!

## ✨ Community

- [Discord](https://discord.strapi.io) - Come chat with the Strapi community including the core team.
- [Forum](https://forum.strapi.io/) - Place to discuss, ask questions and find answers, show your Strapi project and get feedback or just talk with other Community members.
- [Awesome Strapi](https://github.com/strapi/awesome-strapi) - A curated list of awesome things related to Strapi.

---

<sub>🤫 Psst! [Strapi is hiring](https://strapi.io/careers).</sub>

const fs = require('node:fs');
const path = require('node:path');

const publicUploadsPath = path.resolve(
  process.argv[3] || path.join(__dirname, '..', 'public', 'uploads'),
);
const persistentUploadsPath = path.resolve(process.argv[2] || '/data/uploads');

function filesMatch(firstPath, secondPath) {
  if (fs.statSync(firstPath).size !== fs.statSync(secondPath).size) return false;
  const first = fs.openSync(firstPath, 'r');
  try {
    const second = fs.openSync(secondPath, 'r');
    try {
      const firstBuffer = Buffer.allocUnsafe(64 * 1024);
      const secondBuffer = Buffer.allocUnsafe(64 * 1024);
      let bytesRead;
      while ((bytesRead = fs.readSync(first, firstBuffer, 0, firstBuffer.length, null)) > 0) {
        const secondBytesRead = fs.readSync(second, secondBuffer, 0, secondBuffer.length, null);
        if (bytesRead !== secondBytesRead
          || !firstBuffer.subarray(0, bytesRead).equals(secondBuffer.subarray(0, bytesRead))) {
          return false;
        }
      }
      return true;
    } finally {
      fs.closeSync(second);
    }
  } finally {
    fs.closeSync(first);
  }
}

function isWithin(parent, candidate) {
  const relativePath = path.relative(parent, candidate);
  return relativePath === ''
    || (relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath));
}

if (
  isWithin(publicUploadsPath, persistentUploadsPath)
  || isWithin(persistentUploadsPath, publicUploadsPath)
) {
  throw new Error('Public and persistent uploads directories must be separate.');
}

fs.mkdirSync(persistentUploadsPath, { recursive: true });

if (fs.existsSync(publicUploadsPath)) {
  const publicUploadsStats = fs.lstatSync(publicUploadsPath);

  if (publicUploadsStats.isSymbolicLink()) {
    const currentTarget = fs.realpathSync(publicUploadsPath);
    const persistentTarget = fs.realpathSync(persistentUploadsPath);
    if (currentTarget !== persistentTarget) {
      throw new Error(`Uploads path already points to a different directory: ${currentTarget}`);
    }
    console.log(`Uploads already use persistent storage at ${persistentTarget}.`);
    process.exit(0);
  }

  if (!publicUploadsStats.isDirectory()) {
    throw new Error(`Expected an uploads directory at ${publicUploadsPath}.`);
  }

  function copyMissingFiles(sourcePath, destinationPath) {
    for (const entry of fs.readdirSync(sourcePath)) {
      const sourceEntryPath = path.join(sourcePath, entry);
      const destinationEntryPath = path.join(destinationPath, entry);
      const sourceStats = fs.lstatSync(sourceEntryPath);

      if (sourceStats.isSymbolicLink()) {
        throw new Error(`Refusing to migrate symlink in uploads: ${sourceEntryPath}`);
      }

      if (sourceStats.isDirectory()) {
        if (fs.existsSync(destinationEntryPath)) {
          const destinationStats = fs.lstatSync(destinationEntryPath);
          if (!destinationStats.isDirectory()) {
            throw new Error(`Cannot migrate directory over a non-directory: ${destinationEntryPath}`);
          }
        }
        fs.mkdirSync(destinationEntryPath, { recursive: true });
        copyMissingFiles(sourceEntryPath, destinationEntryPath);
      } else if (sourceStats.isFile()) {
        if (fs.existsSync(destinationEntryPath)) {
          if (!fs.lstatSync(destinationEntryPath).isFile()) {
            throw new Error(`Cannot migrate file over a non-file: ${destinationEntryPath}`);
          }
          if (!filesMatch(sourceEntryPath, destinationEntryPath)) {
            throw new Error(`Upload files differ; resolve the conflict before starting: ${sourceEntryPath}`);
          }
        } else {
          fs.copyFileSync(sourceEntryPath, destinationEntryPath, fs.constants.COPYFILE_EXCL);
        }
      } else if (!sourceStats.isFile()) {
        throw new Error(`Unsupported file in uploads: ${sourceEntryPath}`);
      }
    }
  }

  copyMissingFiles(publicUploadsPath, persistentUploadsPath);
  fs.rmSync(publicUploadsPath, { recursive: true });
}

fs.mkdirSync(path.dirname(publicUploadsPath), { recursive: true });
fs.symlinkSync(
  persistentUploadsPath,
  publicUploadsPath,
  process.platform === 'win32' ? 'junction' : 'dir',
);
console.log(`Uploads are linked to persistent storage at ${persistentUploadsPath}.`);

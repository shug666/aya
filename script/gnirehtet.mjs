import path from 'path'
import normalizePath from 'licia/normalizePath.js'

const version = '2.5.1'
const url = `https://github.com/Genymobile/gnirehtet/releases/download/v${version}/gnirehtet-java-v${version}.zip`

const resourcesDir = normalizePath(path.resolve(__dirname, '../resources'))
const gnirehtetDir = `${resourcesDir}/gnirehtet-java`
const zipPath = `${resourcesDir}/gnirehtet-java.zip`

await fs.remove(gnirehtetDir)
await $`curl -Lk ${url} > ${zipPath}`

const tmpDir = `${resourcesDir}/gnirehtet-tmp`
await fs.remove(tmpDir)
await fs.ensureDir(tmpDir)
await $`unzip -o ${zipPath} -d ${tmpDir}`

const dirs = await fs.readdir(tmpDir)
if (dirs.length === 1 && (await fs.stat(path.join(tmpDir, dirs[0]))).isDirectory()) {
  await fs.move(path.join(tmpDir, dirs[0]), gnirehtetDir)
  await fs.remove(tmpDir)
} else {
  await fs.move(tmpDir, gnirehtetDir)
}

await fs.remove(zipPath)

// Set executable permissions for the shell script
await $`chmod +x ${gnirehtetDir}/gnirehtet`

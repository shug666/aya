import path from 'path'
import normalizePath from 'licia/normalizePath.js'

const version = '2.5.1'
const url = `https://github.com/Genymobile/gnirehtet/releases/download/v${version}/gnirehtet-java-v${version}.zip`

const resourcesDir = normalizePath(path.resolve(__dirname, '../resources'))
const gnirehtetDir = `${resourcesDir}/gnirehtet-java`
const zipPath = `${resourcesDir}/gnirehtet-java.zip`

await fs.remove(gnirehtetDir)
await $`curl -Lk ${url} > ${zipPath}`
await $`unzip -o ${zipPath} -d ${resourcesDir}`
await $`mv ${resourcesDir}/gnirehtet-java-v${version} ${gnirehtetDir}`
await fs.remove(zipPath)

// Set executable permissions for the shell script
await $`chmod +x ${gnirehtetDir}/gnirehtet`

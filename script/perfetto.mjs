import path from 'path'
import normalizePath from 'licia/normalizePath.js'

const url = 'https://raw.githubusercontent.com/google/perfetto/v49.0/tools/record_android_trace'

const resourcesDir = normalizePath(path.resolve(__dirname, '../resources'))
const targetFile = `${resourcesDir}/record_android_trace`

await $`curl -Lk ${url} > ${targetFile}`
await $`chmod +x ${targetFile}`

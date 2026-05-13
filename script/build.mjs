const pkg = await fs.readJson('package.json')
const electron = pkg.devDependencies.electron
const homepage = pkg.homepage
const author = pkg.author
delete pkg.devDependencies
pkg.devDependencies = {
  electron,
}
delete pkg.scripts
pkg.scripts = {
  start: 'electron main/index.js',
}
pkg.main = 'main/index.js'
if (homepage) pkg.homepage = homepage
if (author) pkg.author = author

await $`npm run build:main`
await $`npm run build:preload`
await $`npm run build:renderer`

await fs.copy('build', 'dist/build')
await fs.copy('resources', 'dist/resources')
cd('dist')

await fs.writeJson('package.json', pkg, {
  spaces: 2,
})

await $`npm i --production`

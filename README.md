<div align="center">
  <a href="https://aya.liriliri.io/" target="_blank">
    <img src="https://aya.liriliri.io/icon.png" width="400">
  </a>
</div>

<h1 align="center">AYA</h1>

<div align="center">

Android ADB 桌面应用。

<a href="https://www.producthunt.com/posts/aya-1?embed=true&utm_source=badge-featured&utm_medium=badge&utm_souce=badge-aya&#0045;1" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=899538&theme=light&t=1740125747753" alt="AYA - Open&#0032;source&#0032;desktop&#0032;app&#0032;for&#0032;controlling&#0032;android&#0032;devices | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" /></a>

[![Windows][windows-image]][release-url]
[![macOS][mac-image]][release-url]
[![Linux][linux-image]][release-url]
[![Downloads][download-image]][release-url]
![License][license-image]

</div>

[windows-image]: https://img.shields.io/badge/-Windows-blue?style=flat-square&logo=windows
[mac-image]: https://img.shields.io/badge/-macOS-black?style=flat-square&logo=apple
[linux-image]: https://img.shields.io/badge/-Linux-yellow?style=flat-square&logo=linux
[download-image]: https://img.shields.io/github/downloads/liriliri/aya/total?style=flat-square
[release-url]: https://github.com/liriliri/aya/releases
[license-image]: https://img.shields.io/github/license/liriliri/aya?style=flat-square

<img src="https://aya.liriliri.io/screencast.png" style="width:100%">

[AYA](https://aya.liriliri.io/) 是一个用于轻松控制安卓设备的桌面应用，可以看作是 ADB 的图形化封装。

## 安装

点击[这里](https://github.com/liriliri/aya/releases/)下载并安装 AYA。支持 Windows x64、Mac arm64、Mac x64 和 Linux x86_64。

## 功能

<img src="https://aya.liriliri.io/screenshot.png" style="width:100%">

* 屏幕镜像
* 文件浏览
* 应用管理
* 进程监控
* 布局检查器
* CPU、内存与 FPS 监控
* Logcat 日志查看
* 交互式 Shell

更详细的使用说明请阅读 [aya.liriliri.io](https://aya.liriliri.io) 上的文档！

## 日志过滤用法

Logcat 标签页使用单一查询输入框，支持类似 Android Studio 的 `key:value` 过滤语法。

### 基本匹配

| 写法 | 含义 |
|------|------|
| `NullPointerException` | 裸文本，默认匹配 `message` 字段（大小写不敏感子串包含）|
| `tag:MainActivity` | `tag` 字段包含 `MainActivity` |
| `package:com.example` | `package` 字段包含 `com.example` |
| `message:"anr detected"` | `message` 字段包含精确短语（引号内空格、操作符皆为字面）|
| `level:warn` | 日志级别 `>=` WARN（匹配 warn/error/assert），值大小写不敏感，支持首字母 `w` |

### 正则与多值 OR

| 写法 | 含义 |
|------|------|
| `tag~:Main.*` | `tag` 字段正则匹配 `Main.*` |
| `tag~:A\|B\|C` | `tag` 字段正则 OR（匹配 A 或 B 或 C），等价 `tag~:(A\|B\|C)`，`|` 绑定 tag 字段 |
| `-tag~:Main.*` | 排除 `tag` 正则匹配 `Main.*` 的条目 |
| `-tag:MainActivity` | 排除 `tag` 含 `MainActivity` 的条目 |

> 说明：`tag~:A|B|C` 中紧贴 `key~:` 的 `|` 属于该字段值作用域（字段级 OR），不会退化成匹配 message。空格分隔后的 `|` 才是顶层 OR。

### 逻辑组合

| 写法 | 含义 |
|------|------|
| `tag:foo & level:error` | AND：tag 含 foo 且级别 >= error |
| `tag:foo \| tag:bar` | 顶层 OR：tag 含 foo 或 tag 含 bar（`|` 两侧有空格）|
| `(tag:foo \| tag:bar) & level:error` | 括号分组 |
| `tag:foo tag:bar package:x` | 隐式 OR：同 key 多个非否定项自动 OR，即 `(tag:foo \| tag:bar) & package:x` |

优先级：`&`（AND）紧于 `|`（OR），括号最高。

### 崩溃与堆栈

| 写法 | 含义 |
|------|------|
| `is:crash` | 匹配应用崩溃条目（Java `FATAL EXCEPTION` / native `Fatal signal`）及其会话内的堆栈行 |
| `is:stacktrace` | 匹配 Java 堆栈文本特征的行（`at ...(File:line)`、`Caused by:`）|

`is:crash` 会跨条关联同一崩溃会话（同 pid+tag）的后续堆栈行；缓冲淘汰崩溃头后，堆栈行仍能命中。

### 保存快捷命令

输入查询后点击工具栏 `+` 按钮，命名保存为快捷命令（存入 `logcat.json`，跨重启持久化）。工具栏会显示快捷 chip，点击即可一键应用。

### 输入即过滤

打字时合法查询即时过滤；非法中间态（如 `tag:` 末尾悬空）静默忽略不打扰，面板保持上次合法结果。失焦时若查询仍非法，输入框闪红框提示。

### 示例

```
# 看这几个 tag 的日志（正则多值 OR）
tag~:VideoWallpaperService|ZuiPhoneWindowManager|MediaPlayer

# 错误及以上，且不是测试日志
level:error & -message:test

# 崩溃及其堆栈，或任意堆栈行
is:crash | is:stacktrace

# 某包的错误日志，或崩溃
package:com.example.app & level:error | is:crash

# tag 精确匹配（正则锚定）
tag~:^MainActivity$
```

## 开发与测试

### 启动开发

```bash
./start-dev.sh
```

脚本会自动清理 Vite 依赖预打包缓存（`node_modules/.vite`），确保经 `patch-package` 修改的第三方库（如 `luna-logcat`）被重新打包，避免 dev 运行时用到补丁前的旧缓存。

> 改动 `patches/` 下的补丁后，重启 dev 即可（脚本已自动清缓存）。

### 过滤查询 DSL 单元测试

过滤查询语言（`filterQuery.ts`）有独立的单元测试，无需测试框架，用 esbuild 打包即可运行：

```bash
npx esbuild src/renderer/main/components/logcat/filterQuery.test.ts \
  --bundle --format=cjs --platform=node --outfile=/tmp/fq.cjs \
&& node /tmp/fq.cjs
```

覆盖：各操作符（`&`/`|`/`-key:`/`key~:`）、优先级、隐式 OR、引号、`level` `>=` 语义、`is:crash`/`is:stacktrace`、`name:` 恒真、字段值作用域的 `|`（`tag~:A|B|C` 不误匹配 message）、错误态等（70+ 用例）。

### 类型检查与构建

```bash
npx tsc --noEmit -p tsconfig.json   # 类型检查
npx eslint "src/**/*.{ts,tsx}"       # 代码规范
npx vite build --mode=development    # 构建验证
```

## 相关项目

* [licia](https://github.com/liriliri/licia)：AYA 使用的工具库。
* [luna](https://github.com/liriliri/luna)：AYA 使用的 UI 组件。
* [vivy](https://github.com/liriliri/vivy)：图标图片生成。
* [echo](https://github.com/liriliri/echo)：AYA 的鸿蒙版本。

## 贡献

开发环境搭建说明请阅读[贡献指南](https://aya.liriliri.io/guide/contributing.html)。

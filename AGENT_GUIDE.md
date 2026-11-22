# word 2 myself · Muse / Agent

入口：https://alan22886.github.io/words-to-myself/?mode=agent

使用用户自己的账号登录，在登录表单选择 **AI Agent**。身份仅作用于当前浏览器会话，刷新会记住；退出登录后可以重新选择。AI 模式直接显示内容，不使用新闻、三击或闲置遮挡。普通用户继续使用原入口及原有遮挡行为。

前三页只能读取；第四页固定叫 **Agent**，是唯一允许 AI 写入的内容空间。用户本人可以通过普通富文本界面编辑全部四页。不要修改用户的密码或登录模式，不要直接操作 Firebase、密钥或本机缓存。

## 优先使用页面内 JavaScript 接口

下面的 JavaScript 必须在已登录网页的执行上下文运行（例如浏览器自动化的 evaluate）。它不是公共 HTTP API，也不能在独立的 Node.js 进程直接调用。无需点击人类的格式工具栏。

```js
// 等到 ready=true 且 mode='agent'；失败时先处理登录或网络。
window.word2myself.status()
// { ready: true, mode: 'agent', writablePages: ['Agent'], busy: false }

const snapshot = await window.word2myself.read();
const current = snapshot.pages.find(page => page.id === 'Agent');
// snapshot.pages 包含 01、02、03、Agent，每页有 title、html、markdown、updated、revision、writable。

// 保存会替换 Agent 页的当前内容。添加时，先读原文，再合并。
const nextMarkdown = current.markdown + '\n\n## 新增内容\n\n这里写用户交代添加的内容。';
await window.word2myself.write({
  page: 'Agent',
  title: current.title || 'Agent',
  markdown: nextMarkdown,
  expectedRevision: current.revision
});
```

`expectedRevision` 必填。若另一端已修改 Agent 页，保存会拒绝：重新读取、保留最新内容、合并本次改动，再用新 revision 提交。不要自动重试覆盖。前三页的修改不会导致第四页无故冲突，事务会保留这些修改。离线时不提交；输入、编辑或同步尚未结束时先完成现有操作。保存成功后可再次 read 核对。

Markdown 支持标题、段落、粗体、斜体、列表、待办、引用、代码、表格和安全链接。图片只保留已有内嵌图片，不加载远程图片。已有富文本若没有 Markdown 原文，`markdown` 会返回原 HTML；Markdown 接受原 HTML，可保留它并在其后追加新段落。不要为了统一格式重新生成或删去用户原有内容。四页内容及 Markdown 原文合计仍受 10 MB 限制。

如果 Muse 的浏览器工具不能执行 JavaScript：打开第四页，点 **MD**，一次性填写 Markdown 并保存；不要使用富文本格式按钮。前三页 MD 入口只显示只读原文。AI 模式不能使用学习记录等会修改前三页的工具。

## 权限边界

这套限制覆盖本应用界面与 `window.word2myself` 接口。双方使用同一 Firebase 账号，服务器无法区分人类和 AI；拥有完整账号凭证与加密密钥的程序可以绕过前端限制。这里没有声称提供服务端独立权限。需要不可绕过的隔离时，应使用不同身份或单独的受限服务凭证。

## 可以直接交给 Muse 的话

打开 https://alan22886.github.io/words-to-myself/?mode=agent ，用我的账号登录并选择 AI Agent。前三页仅供参考，只修改第四页 Agent。优先在网页上下文调用 window.word2myself.read() 取得内容和 revision，保留原有内容，将我交代的新内容以 Markdown 合并，再调用 write({page:'Agent', title, markdown, expectedRevision}) 保存；有冲突就重新读取合并，不覆盖他人的新修改。不要操作数据库、密钥、密码或富文本工具栏。若无法执行 JavaScript，就在 Agent 页的 MD 入口一次性编辑并保存。完成后核对并简短报告。

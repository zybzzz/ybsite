import type MarkdownIt from 'markdown-it';

// 创建 citation 插件
function citationPlugin(md: MarkdownIt) {
  let frontmatterReferences: Record<string, string> = {}; // 用于存储 frontmatter 中的文献信息
  const citations: string[] = [];
  const citationIds: Record<string, number> = {};

  // 处理 [cite] 标签
  md.inline.ruler.before('link', 'cite', (state, silent) => {
    const start = state.pos;
    const marker = state.src.charAt(start);

    if (marker !== '[') return false;

    const match = /^\[cite\]\(([^)]+)\)/.exec(state.src.slice(start));
    if (!match) return false;

    if (!silent) {
      const citationKey = match[1].trim();
      if (!frontmatterReferences[citationKey]) {
        return false; // 如果代号不在 frontmatter 定义的文献列表中，忽略这个引用
      }

      // 如果该文章已经引用过，使用已有的编号
      let id: number;
      if (citationIds[citationKey] !== undefined) {
        id = citationIds[citationKey];
      } else {
        // 新引用，分配新的编号
        id = citations.length + 1;
        citations.push(frontmatterReferences[citationKey]);
        citationIds[citationKey] = id;
      }

      // 插入引用 [1], [2], 等格式
      const token = state.push('cite_open', 'sup', 1);
      token.meta = { id };
      state.push('text', '', 0).content = `[${id}]`;
      state.push('cite_close', 'sup', -1);
    }

    state.pos += match[0].length;
    return true;
  });

  // 在文章结尾添加文献列表
  md.renderer.rules.cite_open = (tokens, idx) => `<sup id="cite-${tokens[idx].meta.id}">`;
  md.renderer.rules.cite_close = () => '</sup>';

  md.renderer.rules.text = (tokens, idx) => tokens[idx].content;


  md.renderer.rules.paragraph_close = (tokens, idx, options, env, self) => {
    // 渲染正常的段落关闭标记
  let result = self.renderToken(tokens, idx, options);

  // 如果到了最后一个段落，且存在文献引用
  if (idx === tokens.length - 1 && citations.length > 0) {
    let references = `<h2>References</h2><ol>`;
    citations.forEach((cite, i) => {
    // 将文献内容用 strong 和 em 包裹，表示加粗和斜体
    references += `<li id="ref-${i + 1}"><strong><em>${cite}</em></strong></li>`;
    });
    references += '</ol>';
    
    // 将生成的文献列表附加到最后的渲染结果中
    result += references;
  }

  return result;
};
  

  // 提取 frontmatter 中的引用数据
  md.core.ruler.before('normalize', 'extract_frontmatter_references', (state) => {
    if (state.env.frontmatter && state.env.frontmatter.references) {
      frontmatterReferences = state.env.frontmatter.references;
      console.log('Extracted frontmatter references:', frontmatterReferences);
    }
  });
}

export default citationPlugin;

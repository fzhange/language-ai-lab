import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  outDir: 'dist',
  publicDir: 'public',
  manifest: {
    name: 'Words Highlight in Web',
    description: '在任意网页上高亮单词或句子并做笔记，支持多种背景色，数据保存在浏览器本地，支持导入导出',
    permissions: ['storage', 'activeTab', 'scripting', 'contextMenus', 'alarms', 'notifications'],
    host_permissions: ['<all_urls>'],
    icons: {
      16: '/icons/icon16.png',
      32: '/icons/icon32.png',
      48: '/icons/icon48.png',
      128: '/icons/icon128.png'
    },
    action: {
      default_title: 'Words Highlight',
      default_icon: {
        16: '/icons/icon16.png',
        32: '/icons/icon32.png',
        48: '/icons/icon48.png',
        128: '/icons/icon128.png'
      }
    },
    commands: {
      'highlight-selection': {
        suggested_key: { default: 'Alt+H', mac: 'Alt+H' },
        description: '用上次的颜色高亮选中内容'
      },
      'delete-highlight': {
        suggested_key: { default: 'Alt+Shift+H', mac: 'Alt+Shift+H' },
        description: '删除正在编辑或鼠标悬停的高亮'
      }
    }
  },
  hooks: {
    // options 入口自动生成的 options_ui 不含 open_in_tab，这里注入，
    // 让管理页以整页标签打开，而不是内嵌小弹窗。
    'build:manifestGenerated': (_wxt, manifest) => {
      if (manifest.options_ui) manifest.options_ui.open_in_tab = true;
    }
  }
});

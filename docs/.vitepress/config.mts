import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
    base: '/',
    title: "Yibo Zhang's site",
    description: "A Simple Site",
    themeConfig: {
      // https://vitepress.dev/reference/default-theme-config
      nav: [
        { text: 'Home', link: '/' },
        { text: 'Notes', link: '/notes/' },
        { text: 'About me', link: '/personal/'}
      ],
  
      // sidebar: [
      //   {
      //     text: 'Examples',
      //     collapsed: true,
      //     items: [
      //       { text: 'Markdown Examples', link: '/markdown-examples' },
      //       { text: 'Runtime API Examples', link: '/api-examples' }
      //     ]
      //   }
      // ],
  
      socialLinks: [
        { icon: 'github', link: 'https://github.com/zybzzz' }
      ]
    }
})

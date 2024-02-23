import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
    base: '/ybsite/',
    lastUpdated: true,
    title: "Yibo Zhang's site",
    description: "A Simple Site",
    themeConfig: {
      // https://vitepress.dev/reference/default-theme-config
      nav: [
        { text: 'Home', link: '/' },
        { text: 'Notes', link: '/notes/' },
        // { text: 'test', link: '/ybsite/notes/test.pdf' },
        { text: 'About me', link: '/personal/'}
      ],
  
      sidebar: [
        // {
        //   text: 'Examples',
        //   collapsed: true,
        //   items: [
        //     { text: 'Markdown Examples', link: '/ybsite/notes/test.pdf' },
        //     { text: 'Runtime API Examples', link: '/api-examples' }
        //   ]
        // },
        { //level1
          text: 'Simulators & gem5',  
          collapsed: false,
          items: [
            { //level2
              text: 'Debuging gem5 & Debuger usage',
              collapsed: true,
              items: [
                { text: 'pdb handbook', link: '/notes/sim/debuger/pdb' },
                //level3
                {
                  text: 'gdb', 
                  collapsed: true,
                  items: [
                    { text: 'ch4 debuging in gdb', link: '/notes/sim/debuger/gdb/ch4' },
                    { text: 'ch5 debuging in gdb', link: '/notes/sim/debuger/gdb/ch5' },
                  ]
                },
              ]
            }
          ]
        },

        {
          text: 'About me',
          collapsed: false,
          items: [
            { text: 'About me', link: '/personal/' },
          ]
        },
      ],
  
      socialLinks: [
        { icon: 'github', link: 'https://github.com/zybzzz' }
      ]
    }
})

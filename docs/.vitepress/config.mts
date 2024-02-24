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

        {
          text: 'Language learning',
          collapsed: false,
          items: [
            { //level2
              text: 'python',
              collapsed: true,
              link:'/notes/langlearn/python/',
              items: [
                { text: 'fluent_python reading note', link: '/notes/langlearn/python/fluent_python' },
              ]
            }
          ]
        },

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
                  link:'/notes/sim/debuger/gdb/',
                  items: [
                    { text: 'ch4 debuging in gdb', link: '/notes/sim/debuger/gdb/ch4' },
                    { text: 'ch5 debuging in gdb', link: '/notes/sim/debuger/gdb/ch5' },
                    { text: 'ch9 debuging in gdb', link: '/notes/sim/debuger/gdb/ch9' },
                    { text: 'ch10 debuging in gdb', link: '/notes/sim/debuger/gdb/ch10' },
                    { text: 'ch17 debuging in gdb', link: '/notes/sim/debuger/gdb/ch17' },
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

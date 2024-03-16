import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
    markdown: {
      math: true
    },
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
          text: 'Life & Diary',
          collapsed: false,
          items: [
            { //level2
              text: '2024',
              collapsed: true,
              items: [
                { text: '连续两天的深夜奋斗', link: '/life/2024/20240317'},
              ]
            }
          ]
        },


        {
          text: 'Computer Architecture',
          collapsed: false,
          items: [
            { text: 'computer-arch lab, spring 24, USTC', link: '/notes/ca/ca2024spring'},
          ]
        },


        {
          text: 'Language learning',
          collapsed: false,
          items: [
            { //level2
              text: 'python',
              collapsed: true,
              link:'/notes/langlearn/python/',
              items: [
                { text: 'metaclass and class defination in python', link: '/notes/langlearn/python/metaclass_and_class_defination'},
                { text: 'Python function parameter parsing', link: '/notes/langlearn/python/Python_function_parameter_parsing'},
                { text: 'Static and Runtime Name Resolution', link: '/notes/langlearn/python/Static_and_Runtime_Name_Resolution'},
                { text: 'python import statement', link: '/notes/langlearn/python/python_import_statement'},
                { text: 'fluent_python reading note', link: '/notes/langlearn/python/fluent_python' },
              ]
            },
            { //level2
              text: 'cpp',
              collapsed: true,
              items: [
                { //level2
                  text: 'beginning c++20',
                  collapsed: true,
                  items: [
                    { text: 'ch2 basic type', link: '/notes/langlearn/cpp/beginning-cpp20/ch2_basic_type'},
                    { text: 'ch3 Dealing with basic data types', link: '/notes/langlearn/cpp/beginning-cpp20/ch3_Dealing_with_basic_data_types'},
                    { text: 'ch4 Control Flow', link: '/notes/langlearn/cpp/beginning-cpp20/ch4_control_flow'},
                    { text: 'ch5 Arrays and Loops', link: '/notes/langlearn/cpp/beginning-cpp20/ch5_Arrays_and_Loops'},
                    { text: 'ch6 Pointers & References', link: '/notes/langlearn/cpp/beginning-cpp20/ch6_Pointers_and_References'},
                    { text: 'ch7 string', link: '/notes/langlearn/cpp/beginning-cpp20/ch7_string'},
                    { text: 'ch8 function', link: '/notes/langlearn/cpp/beginning-cpp20/ch8_function'},
                    { text: 'ch9 vocabulary types', link: '/notes/langlearn/cpp/beginning-cpp20/ch9_vocabulary_types'},
                    { text: 'ch11 module', link: '/notes/langlearn/cpp/beginning-cpp20/ch11_module'},
                    { text: 'ch12 define a class', link: '/notes/langlearn/cpp/beginning-cpp20/ch12_define_a_class'},
                    { text: 'ch13 operator overloading', link: '/notes/langlearn/cpp/beginning-cpp20/ch13_operator_overloading'},
                    { text: 'ch14 inheritance', link: '/notes/langlearn/cpp/beginning-cpp20/ch14_inheritance'},
                    { text: 'ch15 polymorphism', link: '/notes/langlearn/cpp/beginning-cpp20/ch15_polymorphism'},
                    { text: 'ch16 exception', link: '/notes/langlearn/cpp/beginning-cpp20/ch16_exception'},
                    { text: 'ch17 template', link: '/notes/langlearn/cpp/beginning-cpp20/ch17_template'},
                    { text: 'ch19 first-class function', link: '/notes/langlearn/cpp/beginning-cpp20/ch19_first-class_function'},
                  ]
                }
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
                //level 3
                {
                  text: 'Debugging Techniques', 
                  collapsed: true,
                  items: [
                    { text: 'debug c/cpp macro', link: '/notes/sim/debuger/debugtech/debug_macro' },
                  ]
                },
              ]
            },

            { //level2
              text: 'gem5 simulator',
              collapsed: true,
              items: [
                { text: 'gem5 build process analysis', link: '/notes/sim/gem5/build_process_analysis' },
                { text: 'gem5 simobject source code analysis', link: '/notes/sim/gem5/simobject_source_code_analysis' },
                { text: 'gem5 gem5 startup process', link: '/notes/sim/gem5/gem5_startup_process' },
                { text: 'gem5 event driven programming', link: '/notes/sim/gem5/event_driven_programming' },
              ]
            },

            { //level2
              text: 'source code of gem5',
              collapsed: true,
              items: [
                { //level3
                  text: 'base',
                  collapsed: true,
                  items: [
                    { text: 'extensible.hh', link: '/notes/sim/gem5src/base/extensible_hh' },
                    { text: 'request & packet', link: '/notes/sim/gem5src/base/req_pac' },
                  ]
                },

                { //level3
                  text: 'mem',
                  collapsed: true,
                  items: [
                    { text: 'port.hh', link: '/notes/sim/gem5src/mem/port_hh' },
                  ]
                },
              ]
            },
          ]
        },

        {
          text: 'Compiler',
          collapsed: false,
          items: [
            {
              text: 'tvm',
              collapsed: true,
              items: [
                {
                  text: 'vta',
                  collapsed: true,
                  items: [
                    { text: 'vta for developer', link: '/notes/compiler/tvm/vta/vta_for_developer.md' },
                  ]
                },
              ]
            },

            {
              text: 'dragon book',
              collapsed: true,
              link:'/notes/compiler/dragonbook/',
              items: [
                { text: 'Lexical Analysis Handout', link: '/notes/compiler/dragonbook/Lexical_Analysis_Handout'},
                { text: 'Syntax Analysis Handout', link: '/notes/compiler/dragonbook/Syntax_Analysis_Handout'},
                { text: 'Syntax-Direted Translation Handout', link: '/notes/compiler/dragonbook/Syntax-Direted_Translation_Handout'},
              ]
            },
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

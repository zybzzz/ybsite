# qom

qom 是 qemu 的对象机制，强行在 c 语言上玩出一套对象玩法。这套对象机制的具体实现肯定很复杂，没有时间仔细去研究，但是可以研究大概的机制，具体可以参考 qemu 官网给出的文档和 api 等等。一句话总结就是这套机制很像 Python 的对象机制，按照 python 那类对象类实例对象的定义套里面就行了。

要在 qemu 里面加个 machine 类型，就需要按照这个机制来。过程就是创建一个 typeinfo 对象，然后把这个东西注册掉就行了。

typeinfo 这个结构的定义如下：

```c
/**
 * struct TypeInfo:
 * @name: The name of the type.
 * @parent: The name of the parent type.
 * @instance_size: The size of the object (derivative of #Object).  If
 *   @instance_size is 0, then the size of the object will be the size of the
 *   parent object.
 * @instance_align: The required alignment of the object.  If @instance_align
 *   is 0, then normal malloc alignment is sufficient; if non-zero, then we
 *   must use qemu_memalign for allocation.
 * @instance_init: This function is called to initialize an object.  The parent
 *   class will have already been initialized so the type is only responsible
 *   for initializing its own members.
 * @instance_post_init: This function is called to finish initialization of
 *   an object, after all @instance_init functions were called.
 * @instance_finalize: This function is called during object destruction.  This
 *   is called before the parent @instance_finalize function has been called.
 *   An object should only free the members that are unique to its type in this
 *   function.
 * @abstract: If this field is true, then the class is considered abstract and
 *   cannot be directly instantiated.
 * @class_size: The size of the class object (derivative of #ObjectClass)
 *   for this object.  If @class_size is 0, then the size of the class will be
 *   assumed to be the size of the parent class.  This allows a type to avoid
 *   implementing an explicit class type if they are not adding additional
 *   virtual functions.
 * @class_init: This function is called after all parent class initialization
 *   has occurred to allow a class to set its default virtual method pointers.
 *   This is also the function to use to override virtual methods from a parent
 *   class.
 * @class_base_init: This function is called for all base classes after all
 *   parent class initialization has occurred, but before the class itself
 *   is initialized.  This is the function to use to undo the effects of
 *   memcpy from the parent class to the descendants.
 * @class_data: Data to pass to the @class_init,
 *   @class_base_init. This can be useful when building dynamic
 *   classes.
 * @interfaces: The list of interfaces associated with this type.  This
 *   should point to a static array that's terminated with a zero filled
 *   element.
 */
struct TypeInfo
{
    const char *name;
    const char *parent;

    size_t instance_size;
    size_t instance_align;
    void (*instance_init)(Object *obj);
    void (*instance_post_init)(Object *obj);
    void (*instance_finalize)(Object *obj);

    bool abstract;
    size_t class_size;

    void (*class_init)(ObjectClass *klass, void *data);
    void (*class_base_init)(ObjectClass *klass, void *data);
    void *class_data;

    InterfaceInfo *interfaces;
};
```

在注册的时候把这个结构的实例传到 qemu 提供的接口里，qom 在全局上就能够知道这个类的存在。

方法的意思很容易理解。重点需要关注的是 class_size 和 instance_size，class_size 传入的是所有实例公有数据的大小往往是 sizeof(struct) 这个 struct 包含了类的公有数据，class_size 传入的是每个实例自己数据的大小往往是 sizeof(struct) 这个 struct 包含了实例私有的数据。class_init 传入的是初始化类对象的方法，这个里面可以重写父类的方法等等。instance_init传入的是初始化实例的方法。类对象在注册之后应该由qemu在某个时机自动创建，实例对象则是我们写代码的人自己调用方法去创建的。

接口，接口含在 TypeInfo 中，里面应该含了一些方法，等看到的时候具体再说吧。

属性访问，也是有接口的设计的，具体看文档。
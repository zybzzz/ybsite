# extensible.hh 解析

这是我目前见过相当妙的模板用法，这个文件中定义了 `Extension` 和 `Extensible` 这两个类，`Extension` 用来拓展 `Extensible`，使能够在不改变 `Extensible` 的情况下给 `Extensible` 附加一些信息。

## 对于 `Extension` 的定义

```cpp
/**
 * This is base of every extension.
 */
class ExtensionBase
{
  public:
    explicit ExtensionBase(const unsigned int id)
        : extID(id) {}

    virtual ~ExtensionBase() = default;

    virtual std::unique_ptr<ExtensionBase> clone() const = 0;

    static unsigned int
    maxNumExtensions()
    {
        static unsigned int max_num = 0;
        return ++max_num;
    }

    //用来生成 ExtensionID 用
    unsigned int getExtensionID() const { return extID; }

  private:
    const unsigned int extID;
};

/**
 * This is the extension for carrying additional information.
 * Each type of extension will have a unique extensionID.
 * This extensionID will assign to base class for comparsion.
 *
 * Example usage:
 *
 *   class MyTarget : Extensible<MyTarget> {};
 *
 *   class MyExtension : public Extension<MyTarget, MyExtension>
 *   {
 *     public:
 *       MyExtension();
 *       std::unique_ptr<ExtensionBase> clone() const override;
 *       uint32_t getData();
 *
 *     private:
 *       uint32_t data_;;
 *   };
 *
 *   std::unique_ptr<MyTarget> mytarget(new MyTarget);
 *   std::shared_ptr<MyExtension> myext(new MyExtension);
 *   mytarget->setExtension(myext);
 *
 *   std::shared_ptr<MyExtension> ext = mytarget->getExtension<MyExtension>();
 *   uint32_t data = ext->getData();
 *   mytarget->removeExtension<MyExtension>();
 *
 *   In the example above, MyTarget can carry an extension named MyExtension,
 *   which contains an additional data field. This could be applicated to any
 *   debug information or any data field in any protocol.
 */

template <typename Target, typename T>
class Extension : public ExtensionBase
{
  public:
    Extension() : ExtensionBase(extensionID) {}

    const static unsigned int extensionID;
};

template <typename Target, typename T>
const unsigned int Extension<Target, T>::extensionID =
        ExtensionBase::maxNumExtensions() - 1;
```

`Extension` 这一段代码很有意思，简单的一看这是一个模板，但是里面却没有使用到模板的类型，根本就不知道是为什么，后来发现，这里的两个模板参数都是用来产生不同的 id 用的，对于每个不同传入的 `<typename Target, typename T>` 模板变量，都会有新的类代码生成，而随着新的代码的生成，静态的 id 能继续往上自增。因此对于同一个 `<typename Target, typename T>` 的所有对象，用的是同一个 id。

## 对于 `Extensible` 的定义

```cpp
template <typename Target>
class Extensible
{
  public:
     Extensible() = default;
     Extensible(const Extensible& other)
     {
        // Clone every extension from other.
        for (auto& ext : other.extensions) {
            extensions.emplace_back(ext->clone());
        }
     }
     virtual ~Extensible() = default;

    /**
     * Set a new extension to the packet and replace the old one, if there
     * already exists the same type of extension in this packet. This new
     * extension will be deleted automatically with the shared_ptr<>.
     *
     * @param ext Extension to set
     */
    template <typename T>
    void
    setExtension(std::shared_ptr<T> ext)
    {
        static_assert(std::is_base_of<ExtensionBase, T>::value,
                      "Extension should inherit from ExtensionBase.");
        assert(ext.get() != nullptr);

        auto it = findExtension<T>();

        if (it != extensions.end()) {
            // There exists the same type of extension in the list.
            // Replace it to the new one.
            *it = std::move(ext);
        } else {
            // Add ext into the linked list.
            extensions.emplace_back(std::move(ext));
        }
    }

    /**
     * Remove the extension based on its type.
     *
     * @param ext Extension to remove
     */
    template <typename T>
    void
    removeExtension(void)
    {
        static_assert(std::is_base_of<ExtensionBase, T>::value,
                      "Extension should inherit from ExtensionBase.");

        auto it = findExtension<T>();
        if (it != extensions.end())
            extensions.erase(it);
    }

    /**
     * Get the extension pointer by linear search with the extensionID.
     */
    template <typename T>
    std::shared_ptr<T>
    getExtension()
    {
        static_assert(std::is_base_of<ExtensionBase, T>::value,
                      "Extension should inherit from ExtensionBase.");
        auto it = findExtension<T>();
        if (it == extensions.end())
            return nullptr;
        return std::static_pointer_cast<T>(*it);
    }

  protected:

    /**
     * Go through the extension list and return the iterator to the instance of
     * the type of extension. If there is no such an extension, return the end
     * iterator of the list.
     *
     *  @return The iterator to the extension type T if there exists.
     */
    template <typename T>
    std::list<std::shared_ptr<ExtensionBase>>::iterator
    findExtension()
    {
        auto it = extensions.begin();
        while (it != extensions.end()) {
            if ((*it)->getExtensionID() == T::extensionID)
                break;
            it++;
        }
        return it;
    }

    // Linked list of extensions.
    std::list<std::shared_ptr<ExtensionBase>> extensions;
};
```

这里主要是 `Extensible` 对传入的插件进行检查，对于同一种 `Extension` 的插件只能有一个。

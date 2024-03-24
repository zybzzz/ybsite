# fd_entry & fd_array 文件解析

主要对文件描述符和管理文件描述符的数组进行解析。

## fd_entry

fd_entry 相关的文件中主要进行了文件描述符的抽象。

首先定义 `FDEntry`：

```cpp
class FDEntry : public Serializable
{
  public:

    enum FDClass
    {
        fd_base,
        fd_hb,
        fd_file,
        fd_pipe,
        fd_device,
        fd_socket,
        fd_null
    };

    FDEntry(bool close_on_exec = false)
        : _closeOnExec(close_on_exec)
    { _class = FDClass::fd_base; }

    virtual std::shared_ptr<FDEntry> clone() const = 0;

    bool getCOE() const { return _closeOnExec; }

    FDClass getClass() const { return _class; }

    void setCOE(bool close_on_exec) { _closeOnExec = close_on_exec; }

    virtual void serialize(CheckpointOut &cp) const;
    virtual void unserialize(CheckpointIn &cp);

  protected:
    bool _closeOnExec;
    FDClass _class;
};
```

这之中定义了多种文件描述符的类型，并设置了一个字段记录文件描述符的类型，同时设置 `_closeOnExec` 成员记录是否退出时候释放描述符。这个类作为各种文件描述符的基类。

随后定义 `HBFDEntry`：

```cpp
class HBFDEntry: public FDEntry
{
  public:
    HBFDEntry(int flags, int sim_fd, bool close_on_exec = false)
        : FDEntry(close_on_exec), _flags(flags), _simFD(sim_fd)
    { _class = FDClass::fd_hb; }

    HBFDEntry(HBFDEntry const& reg, bool close_on_exec = false)
        : FDEntry(close_on_exec), _flags(reg._flags), _simFD(reg._simFD)
    { _class = FDClass::fd_hb; }

    std::shared_ptr<FDEntry>
    clone() const override
    {
        return std::make_shared<HBFDEntry>(*this);
    }

    int getFlags() const { return _flags; }
    int getSimFD() const { return _simFD; }

    void setFlags(int flags) { _flags = flags; }
    void setSimFD(int sim_fd) { _simFD = sim_fd; }

  protected:
    int _flags;
    int _simFD;
};
```

随后在文件描述符中引入了主机端（也就是运行gem5的环境）的相关支持，只是简单的拓展，进行 `flag` 和 `simFD` 也就是标志和文件描述符的引入。

```cpp
class FileFDEntry: public HBFDEntry
{
  public:
    FileFDEntry(int sim_fd, int flags, std::string const& file_name,
                uint64_t file_offset, bool close_on_exec = false)
        : HBFDEntry(flags, sim_fd, close_on_exec),
          _fileName(file_name), _fileOffset(file_offset)
    { _class = FDClass::fd_file; }

    FileFDEntry(FileFDEntry const& reg, bool close_on_exec = false)
        : HBFDEntry(reg._flags, reg._simFD, close_on_exec),
          _fileName(reg._fileName), _fileOffset(reg._fileOffset)
    { _class = FDClass::fd_file; }

    std::shared_ptr<FDEntry>
    clone() const override
    {
        return std::make_shared<FileFDEntry>(*this);
    }

    std::string const& getFileName() const { return _fileName; }
    uint64_t getFileOffset() const { return _fileOffset; }
    mode_t getFileMode() const { return _mode; }

    void setFileName(std::string const& file_name) { _fileName = file_name; }
    void setFileOffset(uint64_t f_off) { _fileOffset = f_off; }
    void setFileMode(mode_t mode) { _mode = mode; }

    void serialize(CheckpointOut &cp) const override;
    void unserialize(CheckpointIn &cp) override;

  private:
    std::string _fileName;
    uint64_t _fileOffset;
    mode_t _mode;
};
```

随后对 `HBFDEntry` 进一步拓展，形成了 `FileFDEntry`，也就是对于常规文件的描述符，里面拓展了文件名、偏移、打开的模式等等。

随后还拓展出了管道、socket 通信的额描述符，不再一一解释。

## fd_array

fd_array.hh 文件中主要定义了 `FDArray` 来对单个的文件描述符进行管理，同时，这个类还管理标准输入、标准输出、标准错误流。

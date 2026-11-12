-- 【待 Mac 实机验证】仅负责 Apple Events 调用，共享业务脚本使用 ExtendScript。
-- 参数为应用绝对路径、JavaScript 文本、超时秒数、重试次数、重试间隔。
on quoteText(value)
    set escaped to ""
    repeat with characterValue in characters of value
        set c to characterValue as text
        if c is "\\" or c is "\"" then set escaped to escaped & "\\"
        set escaped to escaped & c
    end repeat
    return "\"" & escaped & "\""
end quoteText

on run argv
    set applicationPath to item 1 of argv
    set javascriptText to item 2 of argv
    set timeoutSeconds to (item 3 of argv) as integer
    set retryCount to (item 4 of argv) as integer
    set waitSeconds to (item 5 of argv) as integer
    -- 动态编译可使用指定 Photoshop 的字典，避免绑定另一版本的应用名称。
    set sourceText to "with timeout of " & timeoutSeconds & " seconds" & linefeed & ¬
        "tell application " & my quoteText(applicationPath) & linefeed & ¬
        "do javascript " & my quoteText(javascriptText) & linefeed & ¬
        "end tell" & linefeed & "end timeout"
    repeat with attempt from 0 to retryCount
        try
            return run script sourceText
        on error errorText number errorNumber
            -- -1743 为权限拒绝，-1712 超时的任务可能仍在运行，均禁止盲目重发。
            if errorNumber is -1743 then
                error "自动化权限被拒绝 (-1743)。请打开 系统设置 → 隐私与安全性 → 自动化，允许当前启动程序控制 Adobe Photoshop，然后重试。原始错误：" & errorText number errorNumber
            end if
            if errorNumber is -1712 then
                error "Photoshop 调用超时 (-1712)，可能存在对话框或忙碌操作。任务可能仍在执行，请检查 Photoshop 与任务日志后再运行。原始错误：" & errorText number errorNumber
            end if
            -- Apple Event 明确未被处理或拒绝时才允许有限重试。
            if errorNumber is -1708 and attempt < retryCount then
                delay waitSeconds
            else
                error "Mac桥接步骤失败，AppleEvent 错误 " & errorNumber & "：" & errorText number errorNumber
            end if
        end try
    end repeat
end run

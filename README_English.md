# deskScript v0.3.6 Development Version
# deskScript

deskScript is an experimental, self-developed scripting language (DSL) that expresses the flow of a program using the metaphor of an "office drawer (desk/drawer)". The file extension is `.ds`. It runs on a Node.js interpreter.

```
desk:greetDesk(string name){
drawer:greetDrawer(action01){
host.var.string:userName(id, name)
inreturn:greetReturn{
"Hello,", userName, "Mr./Ms.!\n"

}
}
outreturn{
greetReturn

}
}
```

## What is deskScript?

- A block of processing is written as a `desk`, and the actual processing within it is written as a `drawer`. When you call the `dis.var` function with arguments, the corresponding `inreturn` block of the `drawer` is evaluated, and the result specified by `outreturn` is returned as a string.

- You can define process-wide global variables with `set:var(type, global/scope/variable name) = value`.

- You can define reusable operations with `function:name(arguments){...}`.

- Control structures: `if(condition):true{...} elif(condition):true{...} else{...}` / `switch(target):case("value"){...} default{...}` / `while(condition):true{...}` / `try{...} catch(dis.var:variable){...} end{...}` / `for(dis.var:name in ++1):N{...} end{...}` / `forever{...}` (see below).

- You can use very simple classes (fields + constructor) with `set:class(...)` / `class:name(...), init(...){...}` / `new:name(...)`.

- You can perform exclusive locking on drawers or desks with `lock:drawer(name){...}` / `unlock:drawer(name)` / `name.lock(type=drawer|desk, timing=now|desk:X.start|desk:X.end)` / `name.unlock(...)`.

- You can immediately destroy variables with `shred:var(name)` / `var:name.delete()`.

- You can call multiple desks and merge the results with `meeting:join(deskA("arg"), deskB("arg2"))`, and pass messages between desks with `outbox:send(key, value)` / `inbox:receive(key)`. - You can record the change history of a variable using `audit:trail(variable name)`.
- You can hook into various events (desk start/end, lock/unlock, variable change/deletion, for loop start/end, forever start/end) using `timing:key{...}`.
- By simply writing `HTML` in `import.ds.txt` instead of `HTML.document.~`, you can directly call real DOM manipulations (`document.getElementById(...)`, etc.) when running in a browser (see the section on browser execution below).

### Pairing Rules for `@tag(name=name)` and `tag:name.method()`

Some syntax consists of an annotation (`@tag(...)`) placed immediately before `desk`/`drawer` and a corresponding operation syntax (`tag:name.method()`). Any future additions to this syntax will also adhere to this pairing.

| Annotation | Corresponding Operation Syntax | Purpose |
|---|---|---|
| `@object(name=Name)` | `object:Name.new(Field:Type=Value,,,)` / `Name.FieldName` | Creating and referencing records in the object schema |
| `@setin(name=Name, type=ctrl)` | `setin:Name.stop()` / `.start()` / `.delete(type=comp\|leav)` / `.add()` | Named external controls for `while`/`forever` |

(`set:` conflicts with `set:var` / `set:class` / `set:desk`, so we use `@setin` / `setin:` instead of `@set`)

### Object Schema (`object:`)

Declares the schema outside of `desk`.

```
object:UserProfile(type=global){
userName:string:notnull
age:int
code:string:len[4]
mail:string:re[^[a-z]+@[a-z]+$]
}
```
- Field formatting: `name:type` (null allowed if omitted) / `name:type:notnull` (required) / `name:type:len[N]` (maximum number of characters) / `name:type:re[regular expression]` (pattern matching)
- `type=global`: Shared memory shared by multiple drawers tagged with the same `@object(name=name)`
- `type=host`: A dedicated area for one drawer tagged with `@object(name=name)` (invisible to other drawers)
- `type=null`: No scope specified. **A local value valid only for that single desk call.**

Using it (in the drawer):

```
desk:saveProfile(string name){
@object(name=UserProfile)
drawer:d(action01){
host.var.string:name(id, name)
inreturn:r{
object:UserProfile.new(userName:string=name, age:int=20, code:string=AB12, mail:string=abc@xyz),
"Registered name: ", UserProfile.userName, "\n"
}
}
outreturn{ r }
}
```

This coexists separately from the class functionality of `set:class`/`class:`/`new:` (think of it this way: classes are for "creating and using instances on the spot," while objects are for "passing values ​​between multiple drawers").

### Named Control with `forever{}` and `@setin`

`forever` was previously `forever(condition){...}`, but the syntax has been changed to **`forever{...}` without arguments**. Because a true infinite loop would hang in synchronous JavaScript, it executes with a safety limit (default 1000 iterations). Placing `@setin(name=name, type=ctrl)` immediately before it allows you to call `setin:name.stop()` from within the `timing:forever.start{...}` hook to stop the main function without executing it even once.


```
desk:watchdogDemo(string dummy){
drawer:d(action01){
host.var.string:dummy(id, dummy)
inreturn:r{
@setin(name=watchdog, type=ctrl)
forever{
"This is a dangerous zone. Execution will not occur if stop is enabled\n"

}
}
}
outreturn{ r }
}
timing:forever.start{
setin:watchdog.stop()
}
```

The same `@setin(...)` can be prefixed to `while(condition):true{...}`, raising the safety limit to 1000 times (previously 5). `setin:name.delete(type=comp)` allows for complete deletion (cannot be recovered), and `type=leav` allows for temporary deletion (can be recovered with `setin:name.add()`).

## Engine Configuration

This repository includes two engine implementations.

| Directory | Contents |
|---|---|
| `index.js` / `src/*.js` (directly under the root, older individual implementations of If/Switch/While etc. in `src/blocks/`) | Pure JS implementation from the very beginning |
| TypeScript implementation that is being continuously modified and features added in this work (after compilation, it is also placed as `index.js`/`src/*.js`) | Each syntax is separated by function in `src/blocks/`. Details below |

`src/blocks/` structure of the TS-derived engine:

| File | Content |
|---|---|
| `BlockContext.ts` | State and helpers shared by all blocks (lock state, `@setin` control handle, object storage, etc.) |
| `NestableDispatcher.ts` | A unified dispatcher that processes `if`/`switch`/`while`/`try`/`forever`/`for`/`lock:drawer`/`intern:desk`/`stamp`/`shift` "from the leftmost (outermost) one in the text". Introduced as a fundamental fix for nesting bugs like "if statements inside for loops" that occur when processing items individually in a fixed order. |
| `DrawerLockBlock.ts` | `unlock:drawer` / `@drawer` tag / `name.lock` and `unlock` statements (the `lock:drawer(){...}` body is on the NestableDispatcher side) |
| `VarLifecycleBlock.ts` | `shred:var` / `var:name.delete()` |
| `ControlBlock.ts` | `forever`/`while` operations named with `@setin` (e.g., `setin:name.stop()`) |
| `ObjectBlock.ts` | `object:name.new(...)` / `name.fieldname` |
| `MeetingJoinBlock.ts` | `meeting:join(...)` |
| `MailboxBlock.ts` | `outbox:send` / `inbox:receive` |
| `AuditTrailBlock.ts` | `audit:trail(...)` |
| `ClassBlock.ts` | `set:class` / `class:` / `new:` / Instance field reference |

## Application
- **As a CLI tool**: You can directly execute `index.js` from Node.js and run business flows written in `.ds` files (approval gates `stamp`, audit logs `audit:trail`, exclusive locks `lock:drawer`, shared objects `object:`, etc.) as scripts. It can be used as a repository for automation scripts based on business metaphors.

- **As dynamic HTML manipulation in the browser**: By embedding the included `wnode.js` into HTML like `<script src="wnode.js" data-engine="./" data-base="./" data-main="main.ds" data-import="import.ds.txt"></script>`, `main.ds` will be executed directly in the browser, allowing you to rewrite the page's DOM via `HTML.document.~` and add click events (`index.html` is the sample).

- **As a small, custom language for learning and experimentation**: Adding syntax is as simple as adding one function per file to `src/blocks/`, and for nested syntax, you just register it in `DETECTORS` in `NestableDispatcher.ts`. This design makes it easy to use as a subject for prototyping custom syntax.

## Points to Note When Using It

- **Operates with a mechanism equivalent to `eval`**: Expression evaluation internally uses `new Function(...)`. Expressions containing dangerous keywords (`process` / `require` / `Function` / `eval` / `constructor` / `__proto__`, etc.) are rejected, but this is a simple blocklist and not a complete sandbox. **It is not suitable for running `.ds` files written by untrusted third parties.** **Please use it to run scripts written by yourself (or trusted members).**

- **Handling of commas**: Output is constructed using a "top-level comma" delimiter. While commas within strings and parentheses are no longer treated as delimiters, be careful with parenthetical correspondence and closing quotes when writing complex expressions.

- **Syntax errors are included in the output as `[Eval Warning]`**: To avoid silently suppressing failures, incorrect expressions will result in a warning message appearing directly in the output string. Use this as a debugging indicator.

- **Safety limits for `while` / `forever`**: To prevent infinite loops from hanging, execution is forcibly terminated after a maximum of 1000 iterations by default. To ensure it stops earlier, call `setin:name.stop()` with `@setin(name=name, type=ctrl)`.

- **State persists within the process**: There is no explicit way to clear the lock state of `lock:drawer`, the logs of `audit:trail`, instances of `class`, shared records of `object`, control handles of `@setin`, etc. (Only `type=null` objects are reset with each desk call). It is intended for use in a single script execution, and will accumulate if the same instance is reused on a server, etc.

- **Do not include executable syntax patterns in generated messages**: If you accidentally include executable syntax like `name.add()` in the internal confirmation message generation, it may be mistakenly flagged as a real call in the next scan (this is a bug we have actually encountered). When adding your own syntax, be careful not to include other syntax patterns in the literal of the generated string.

- **It is a simple parser based on regular expressions**: Writing `{` or `}` in a string may cause the parsing side to miscount the curly braces. Because it's not a strict AST/tokenizer, it's recommended to test complex nested structures on a small scale beforehand.
- **You need to write the corresponding syntax immediately after the `@object`/`@setin` tags**: `@object(name=X)` should be written directly after the `drawer:`, and `@setin(name=X, type=ctrl)` should be written directly after the `while`/`forever`, separated by a space or line break. If other statements are placed in between, the linking will not work.

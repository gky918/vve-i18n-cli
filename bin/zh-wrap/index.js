#!/usr/bin/env node

"use strict";
const program = require("commander");
const utils = require("../utils");
const { loadConfig } = require("../configuration");
const vfs = require("vinyl-fs");
const map = require("map-stream");
const path = require("path");
const fs = require("fs");

function commaSeparatedList(value, split = ",") {
  return value.split(split).filter(item => item);
}

program
  .version(require('../../package.json').version)
  .option("--cwd <path>", "工作目录")
  .option("--root-dir <path>", "国际文本所在的根目录")
  .option(
    "--config <path>",
    "配置文件的路径，没有配置，默认路径是在${cwd}/vve-i18n-cli.config.js"
  )
  .option("--no-config", "是否取配置文件")
  .option(
    "--i18n-file-rules <items>",
    "匹配含有国际化文本的文件规则",
    commaSeparatedList
  )
  .option(
    "--ignore-i18n-file-rules <items>",
    "不匹配含有国际化文本的文件规则",
    commaSeparatedList
  )
  .option(
    "--ignore-pre-geg <items>",
    "被忽略的前缀，是个数组",
    commaSeparatedList
  )
  .option(
    "--ignore-text <items>",
    "被忽略的文本，是个数组",
    commaSeparatedList
  )
  .option(
    "--ignore-attr <items>",
    "被忽略的属性，该属性的value值如果是中文，则不会被包裹，是个数组",
    commaSeparatedList
  )
  .option(
    "--disabledRules <items>",
    "如果满足匹配的内容，就忽略包裹",
    commaSeparatedList
  )
  .option("--i18n-import-for-js <item>", "js相关文件需要引入的国际化文件")
  .option("--js-i18n-func-name <item>", "js相关文件需要使用国际化方法")
  .option("--vue-i18n-func-name <item>", "vue相关文件需要使用的国际化方法")
  .parse(process.argv);

const config = {
  // 工作目录
  cwd: ".",
  // 根目录，国际文本所在的根目录
  rootDir: "src",
  // 配置文件的路径，没有配置，默认路径是在${cwd}/vve-i18n-cli.config.js
  config: undefined,
  // 是否取配置文件
  noConfig: false,
  // 匹配含有国际化文本的文件规则
  i18nFileRules: ["**/*.+(vue|js)"],
  // 不匹配含有国际化文本的文件规则
  ignoreI18nFileRules: [],
  // 被忽略的前缀
  ignorePreReg: [
    /t\s*\([\s\n]*$/,
    /tl\s*\([\s\n]*$/,
    /console\.(?:log|error|warn|info|debug)\s*\(\s*$/,
    new RegExp("//.+"),
  ],
  // 被忽略的文本
  ignoreText: [
    /t\(/,
    /tl\(/,
  ],
  // 被忽略的属性，该属性的value值如果是中文，则不会被包裹
  ignoreAttr: [],
  // 如果满足匹配的内容，就忽略包裹
  disableRules: [
    // 单行禁用，使用：在当前行添加 // vve-i18n-zh-wrap-disable-line
    /(.*\/\/(?:[^\S\r\n]*|.*[^\S\r\n]+)vve-i18n-zh-wrap-disable-line(?:[^\S\r\n]*|[^\S\r\n]+.*))/g,
    // 下一行禁用，使用：在上一行添加 // vve-i18n-zh-wrap-disable-next-line
    /\/\/(?:[^\S\r\n]*|.*[^\S\r\n]+)vve-i18n-zh-wrap-disable-next-line(?:[^\S\r\n]*|[^\S\r\n]+.*)\n(.+)/g,
    // 代码块禁用，使用：在需要的地方包括
    /\/\*\s*vve-i18n-zh-wrap-disable\s*\*\/([\s\S]*?)(?:(?:\/\*\s*vve-i18n-zh-wrap-enable\s*\*\/)|$)/g
  ],
  // js相关文件需要引入的国际化文件
  i18nImportForJs: "import i18n from '@/i18n'",
  // js相关文件需要使用国际化方法
  jsI18nFuncName: 'i18n.t',
  // vue相关文件需要使用的国际化方法
  vueI18nFuncName: '$t',
};

Object.assign(config, program);

const CONFIG_JS_FILENAME = "vve-i18n-cli.config.js";

let absoluteCwd = path.resolve(config.cwd);

// 优先判断是否需要读取文件
if (!config.noConfig) {
  let configFilePath = path.join(absoluteCwd, CONFIG_JS_FILENAME);
  if (config.config) {
    configFilePath = path.resolve(config.config);
  }
  if (fs.existsSync(configFilePath)) {
    const conf = loadConfig(configFilePath);
    if (conf && conf.options && conf.options.zhWrap) {
      Object.assign(config, conf.options.zhWrap, program);
    }
  }
}

// 制定配置文件后，cwd在配置文件中定义，则cwd就需要重新获取
if (!program.cwd) {
  absoluteCwd = path.resolve(config.cwd);
}

const { ignorePreReg, i18nImportForJs, jsI18nFuncName, vueI18nFuncName, ignoreText, ignoreAttr } = config

const absoluteRootDir = path.resolve(absoluteCwd, config.rootDir);

// 匹配中文字符的正则表达式： [\u4e00-\u9fa5] // https://www.w3cschool.cn/regexp/nck51pqj.html
// 匹配双字节字符(包括汉字在内)：[^\x00-\xff] // https://www.w3cschool.cn/regexp/nck51pqj.html
// (?!\$t\()([^\x00-\xff]+) 不已啥开头
// ([^\x00-\xff]+)
// 匹配中文
const regI18n = new RegExp(/([^\x00-\xff]+)/, "g");

// 左边是否是>
function letfRt (str, startIndex, range = 50) {
  const end = startIndex - range
  for (let i = startIndex; i >= end; i--) {
    if (str.charAt(i) === '>') return true
    if (!str.charAt(i).trim()) continue
    return false
  }
  return false
}
// 右边是否是<
function rightLt (str, startIndex, range = 50) {
  const end = startIndex + range
  for (let i = startIndex; i <= end; i++) {
    if (str.charAt(i) === '<') return true
    if (!str.charAt(i).trim()) continue
    return false
  }
  return false
}
// 是否在 > 之间 <
function betweenRtAndLt (strContent, match, index, range) {
  return letfRt(strContent, index - 1, range) && rightLt(strContent, match.length + index, range)
}

// 获取当前元素所在行之前的元素
function getLinePreText(str, match, index, range = 300, leftShift = 4) {
  const startIndex = index - 1
  let end = startIndex - range
  for (let i = startIndex; i >= end; i--) {
    if (str.charAt(i) === '\n') {
      end = i

      /**
       * bug 一下格式，中文会被多加一个，所以到换，多往前移动几个字符，避免$t(的内容换行导致又多包裹一层
          $t(
            '翻译文字'
          )
       */
      if (leftShift && end >= leftShift) {
        end = end - leftShift
      }
      break;
    }
  }
  return str.slice(end, index)
}

// 获取当前元素所在行之后的元素
function getLineSubfixText(str, match, index, range = 300) {
  const startIndex = match.length + index
  let end = startIndex + range
  for (let i = startIndex; i <= end; i++) {
    if (str.charAt(i) === '\n') {
      end = i
      break;
    }
  }
  return str.slice(startIndex, end)
}

// 判定是否被双斜杆注释包裹
function isWrapByDoubelSlashComment (str, match, index, range = 500) {
  const linePreText = getLinePreText(str, match ,index, range)
  return linePreText.indexOf('//') !== -1
}

const i18nWrapPrefixReg = /t\s*\(\s*$/
// 是否被$t包裹 $t("你好") 识别出来的中文
function isWrapByI18n (str, match, index, range) {
  // const subfixText = getLineSubfixText(str, match, index, range) // 不判断后缀了，直接判定前缀
  // if (subfixText.trim().charAt(0) !== ')') return false
  const linePreText = getLinePreText(str, match ,index, range)
  if (!i18nWrapPrefixReg.test(linePreText.trim())) return false
  return true
}

// 前缀是否满足要求
function prefixTestReg (reg, str, match, index, range) {
  const linePreText = getLinePreText(str, match ,index, range)
  return new RegExp(reg).test(linePreText.trim())
}

// 国际化文本，中文开头，可以包含中文数字.和空格，用户匹配
const i18nContentRegForTest = /([^"{}\n]*[^\x00-\xff]+[^"{}\n]*)|([^'{}\n]*[^\x00-\xff]+[^{}'\n]*)/g
const i18nContentReg = new RegExp(i18nContentRegForTest, 'g')

// 判定是否包含中文，用于test
const i18nContenTestReg = /([^"{}\n]*[^\x00-\xff]+[^"{}\n]*)|([^'{}\n]*[^\x00-\xff]+[^{}'\n]*)/
// 处理template
const templateReg = new RegExp("<template>([\\s\\S]+)<\\/template>", "i")
// 处理script
const scriptReg = new RegExp("<script>([\\s\\S]+)<\\/script>", "i")
// tag的内容正则匹配
const TagContentReg = new RegExp('>((?:[^\x00-\xff]|\w|[:0-9{}.A-Za-z\\s])+)<', 'g')
// html start tag匹配正则
const startTagReg = new RegExp(/<(?:[-A-Za-z0-9_]+)((?:\s+[a-zA-Z_:@][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:(?:"[^"]*")|(?:'[^']*')|[^>\s]+))?)*)\s*(?:\/?)>/, 'g')
// 属性的正则
const attrReg = /([@:a-zA-Z_][-a-zA-Z0-9_.]*)(?:\s*=\s*(?:(?:"((?:\\.|[^"'])*)")|(?:'((?:\\.|[^'"])*)')))/g;
// 前后非空白，这里必须是三个字符
const nonPreSubWhiteReg = /\S.+\S/
// 国际化字符串，被单引号或者双引号包裹，内容中文开头
const i18nStrReg = /"([^"{}\n]*[^\x00-\xff]+[^"{}\n]*)"|'([^'{}\n]*[^\x00-\xff]+[^'{}\n]*)'/g

// 解析vue文件
function processVueFile (fileContent) {
  // 过滤出template相关内容，处理tag内容的国际化
  let newFileContent = fileContent.replace(templateReg, function (match, templateKey, index) {
    // 经过TagContentReg的过滤，$()"",这些关键字都不会被当作国际化文本处理
    let newTemplateKey = templateKey.replace(TagContentReg, function (match, tagContentKey, index) {
      if (!tagContentKey.trim()) return match
      // console.log(match, tagContentKey)
      // 经过这一层过滤，会过滤去tag内容的中文，并加上国际化文本
      const newTagContentKey = tagContentKey.replace(i18nContentReg, function (match) {
        const trimMatch = match.trim()

        for (let i = 0; i < ignoreText.length; i++) {
          if (typeof ignoreText[i] === 'string') {
            if (ignoreText[i] === trimMatch) return match
          } else if (Object.prototype.toString.call(ignoreText[i]) === "[object RegExp]") {
            if (ignoreText[i].test(trimMatch)) return match
          }
        }

        // 例子 <p> 啦啦啦 </p>  变成 <p> {{$t('啦啦啦')}} </p>
        return match.replace(trimMatch, `{{${vueI18nFuncName}('${trimMatch}')}}`)
      })
      return match.replace(tagContentKey, newTagContentKey)
    })
    return match.replace(templateKey, newTemplateKey)
  })
  // console.log(newFileContent)
  // 过滤出template相关内容，处理tag属性的国际化
  newFileContent = newFileContent.replace(templateReg, function (match, templateKey, index) {
    // 过滤出属性 <p title="希望的田野">
    let newTemplateKey = templateKey.replace(startTagReg, function (match, key, index) {
      const attrStr = key
      if (!attrStr.trim()) return match
      const newAttStr = attrStr.replace(attrReg, function (match, name, doubleQuoteValue, singleQuoteValue) {
        const value = doubleQuoteValue || singleQuoteValue
        if (name.charAt(0) === '@' || name.charAt(0) === ':') return match
        if (!i18nContentRegForTest.test(value)) return match

        for (let i = 0; i < ignoreText.length; i++) {
          if (typeof ignoreText[i] === 'string') {
            if (ignoreText[i] === value) return match
          } else if (Object.prototype.toString.call(ignoreText[i]) === "[object RegExp]") {
            if (ignoreText[i].test(value)) return match
          }
        }

        for (let i = 0; i < ignoreAttr.length; i++) {
          if (typeof ignoreAttr[i] === 'string') {
            if (ignoreAttr[i] === name) return match
          } else if (Object.prototype.toString.call(ignoreAttr[i]) === "[object RegExp]") {
            if (ignoreAttr[i].test(name)) return match
          }
        }

        // console.log(arguments)
        // vueI18nFuncName = '$t' => `$t(${value})`
        return `:${name}="${vueI18nFuncName}('${value}')"`
      })
      return match.replace(attrStr, newAttStr)
    })
    return match.replace(templateKey, newTemplateKey)
  })
  // console.log(newFileContent)
  // 过滤出script相关内容，过滤出被引号包裹的中文字符串，对这种类型进行替换国际化替换
  newFileContent = newFileContent.replace(scriptReg, function (match, scriptKey, index) {
    let newScriptKey = scriptKey.replace(i18nStrReg, function (match, key, key2, index) {
      for (let i = 0; i < ignorePreReg.length; i++) {
        if (prefixTestReg(ignorePreReg[i], scriptKey, match, index, 50)) return match
      }
      for (let i = 0; i < ignoreText.length; i++) {
        if (typeof ignoreText[i] === 'string') {
          if (ignoreText[i] === match.slice(1, -1)) return match
        } else if (Object.prototype.toString.call(ignoreText[i]) === "[object RegExp]") {
          if (ignoreText[i].test(match.slice(1, -1))) return match
        }
      }
      if (match.indexOf('/*') !== -1) return match
      // vueI18nFuncName = '$t' => `this.$t(${match})`
      return `this.${vueI18nFuncName}(${match})`
    })

    if (scriptKey === newScriptKey) {
      // bug 如果scriptKey出现$结尾的，比如'$'，及时replace两者一样，还是会被替换
      return match
    } else {
      return match.replace(scriptKey, newScriptKey)
    }
  })
  // console.log(newFileContent)
  return newFileContent
}

// 解析html文件
function processHtmlFile (fileContent) {
  let newFileContent = fileContent;
  // 先移除 html 里的 script，style，link 代码块
  const scriptCodes = [];
  const styleCodes = [];
  const linkCodes = [];
  newFileContent = newFileContent.replace(/(<script[\s\S]*?<\/script>)/ig, function(match, key, index) {
    const count = scriptCodes.length;
    scriptCodes.push(match);
    return match.replace(key, `@@scriptCodes_${count}@@`);
  });
  newFileContent = newFileContent.replace(/(<style[\s\S]*?<\/style>)/ig, function(match, key, index) {
    const count = styleCodes.length;
    styleCodes.push(match);
    return match.replace(key, `@@styleCodes_${count}@@`);
  });
  newFileContent = newFileContent.replace(/(<link[\s\S]*?<\/link>)/ig, function(match, key, index) {
    const count = linkCodes.length;
    linkCodes.push(match);
    return match.replace(key, `@@linkCodes_${count}@@`);
  });
  // 过滤出template相关内容，处理tag内容的国际化
  newFileContent = newFileContent.replace(TagContentReg, function (match, tagContentKey, index) {
    if (!tagContentKey.trim()) return match
    // console.log(match, tagContentKey)
    // 经过这一层过滤，会过滤去tag内容的中文，并加上国际化文本
    const newTagContentKey = tagContentKey.replace(i18nContentReg, function (match) {
      const trimMatch = match.trim()

      for (let i = 0; i < ignoreText.length; i++) {
        if (typeof ignoreText[i] === 'string') {
          if (ignoreText[i] === trimMatch) return match
        } else if (Object.prototype.toString.call(ignoreText[i]) === "[object RegExp]") {
          if (ignoreText[i].test(trimMatch)) return match
        }
      }

      // 例子 <p> 啦啦啦 </p>  变成 <p> {{$t('啦啦啦')}} </p>
      return match.replace(trimMatch, `{{${vueI18nFuncName}('${trimMatch}')}}`)
    })
    return match.replace(tagContentKey, newTagContentKey)
  })
  // console.log(newFileContent)
  // 过滤出template相关内容，处理tag属性的国际化
  newFileContent = newFileContent.replace(startTagReg, function (match, key, index) {
    const attrStr = key
    if (!attrStr.trim()) return match
    const newAttStr = attrStr.replace(attrReg, function (match, name, doubleQuoteValue, singleQuoteValue) {
      const value = doubleQuoteValue || singleQuoteValue
      if (name.charAt(0) === '@' || name.charAt(0) === ':') return match
      if (!i18nContentRegForTest.test(value)) return match

      for (let i = 0; i < ignoreText.length; i++) {
        if (typeof ignoreText[i] === 'string') {
          if (ignoreText[i] === value) return match
        } else if (Object.prototype.toString.call(ignoreText[i]) === "[object RegExp]") {
          if (ignoreText[i].test(value)) return match
        }
      }

      for (let i = 0; i < ignoreAttr.length; i++) {
        if (typeof ignoreAttr[i] === 'string') {
          if (ignoreAttr[i] === name) return match
        } else if (Object.prototype.toString.call(ignoreAttr[i]) === "[object RegExp]") {
          if (ignoreAttr[i].test(name)) return match
        }
      }

      // console.log(arguments)
      // vueI18nFuncName = '$t' => `$t(${value})`
      return `:${name}="${vueI18nFuncName}('${value}')"`
    })
    return match.replace(attrStr, newAttStr)
  })
  // console.log(newFileContent)
  // 再恢复 html 里的 script，style，link 代码块
  newFileContent = newFileContent.replace(/(@@scriptCodes_.*?@@)/ig, function(match, key, index) {
    const i = match.match(/@@scriptCodes_(.*?)@@/)[1];
    return match.replace(key, scriptCodes[i]);
  });
  newFileContent = newFileContent.replace(/(@@styleCodes_.*?@@)/ig, function(match, key, index) {
    const i = match.match(/@@styleCodes_(.*?)@@/)[1];
    return match.replace(key, styleCodes[i]);
  });
  newFileContent = newFileContent.replace(/(@@linkCodes_.*?@@)/ig, function(match, key, index) {
    const i = match.match(/@@linkCodes_(.*?)@@/)[1];
    return match.replace(key, linkCodes[i]);
  });
 
  return newFileContent
}

// 解析js文件
function processJsFile (fileContent) {
  let newFileContent = fileContent
  newFileContent = newFileContent.replace(i18nStrReg, function (match, key, key2, index) {
    for (let i = 0; i < ignorePreReg.length; i++) {
      if (prefixTestReg(ignorePreReg[i], newFileContent, match, index, 50)) return match
    }
    for (let i = 0; i < ignoreText.length; i++) {
      if (typeof ignoreText[i] === 'string') {
        if (ignoreText[i] === match.slice(1, -1)) return match
      } else if (Object.prototype.toString.call(ignoreText[i]) === "[object RegExp]") {
        if (ignoreText[i].test(match.slice(1, -1))) return match
      }
    }
    // jsI18nFuncName = 'i18n.t' => `i18n.t(${match})`
    return `${jsI18nFuncName}(${match})`
  })
  if (newFileContent !== fileContent && fileContent.indexOf(i18nImportForJs) === -1 && i18nImportForJs) {
    newFileContent = i18nImportForJs + '\n' + newFileContent
  }
  // console.log(newFileContent)
  return newFileContent
}

// 禁用的文本列表，临时使用
const disableTextArr = []

// 根据匹配规则，把匹配的内容，替换成一个占位符
function replaceWithPlaceholderByRule (str, rule) {
  str = str.replace(new RegExp(rule), function(match, key, index) {
    const count = disableTextArr.length;
    disableTextArr.push(key);
    return match.replace(key, `@@@@@@disableText_${count}@@@@@@`);
  });
  return str
}

// 根据匹配规则列表，把匹配的内容，替换成一个占位符
function replaceWithPlaceholder (str, disableRules) {
  for (let i = 0; i < disableRules.length; i++) {
    str = replaceWithPlaceholderByRule(str, disableRules[i])
  }
  return str
}

// 把占位的内容，还原
function placeholderRestore (str) {
  str = str.replace(/(@@@@@@disableText_(\d+)@@@@@@)/g, function(match, key, key2, index) {
    return disableTextArr[key2]
  });
  return str
}

function run () {
  vfs
  .src(config.i18nFileRules.map(item => path.resolve(absoluteRootDir, item)),{
      ignore: config.ignoreI18nFileRules.map(item => path.resolve(absoluteRootDir, item)),
      dot: false
    }
  )
  .pipe(
    map((file, cb) => {
      console.log('开始解析', file.path)
      const extname = path.extname(file.path)
      let originfileContent = file.contents.toString()

      // 根据禁用匹配规则列表，把匹配的内容替换成一个占位符，之后就不会为这些代码的国际化文本进行包裹
      let fileContent = replaceWithPlaceholder(originfileContent, config.disableRules)

      let newFileContent = ''
      if (extname.toLowerCase() === '.vue') {
        newFileContent = processVueFile(fileContent)
      } else if (extname.toLowerCase() === '.js') {
        newFileContent = processJsFile(fileContent)
      } else if (extname.toLowerCase() === '.html' || extname.toLowerCase() === '.htm') {
        newFileContent = processHtmlFile(fileContent)
      }

      // 把之前不处理的代码还原
      newFileContent = placeholderRestore(newFileContent)

      if (!newFileContent) {
        console.log('内容为空，无需处理', file.path)
      } else if (newFileContent !== originfileContent) {
        fs.writeFileSync(file.path, newFileContent)
        console.log('处理完成', file.path)
      } else {
        console.log('内容未改变，无需处理', file.path)
      }
      cb()
    })
  )
  .on("end", () => {
    console.log('全部处理完成')
  });
}

run()

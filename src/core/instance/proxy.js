/* not type checking this file because flow doesn't play well with Proxy */

import config from "core/config";
import { warn, makeMap, isNative } from "../util/index";

let initProxy;

if (process.env.NODE_ENV !== "production") {
  const allowedGlobals = makeMap(
    "Infinity,undefined,NaN,isFinite,isNaN," +
      "parseFloat,parseInt,decodeURI,decodeURIComponent,encodeURI,encodeURIComponent," +
      "Math,Number,Date,Array,Object,Boolean,String,RegExp,Map,Set,JSON,Intl," +
      "require" // for Webpack/Browserify
  );

  const warnNonPresent = (target, key) => {
    warn(
      `Property or method "${key}" is not defined on the instance but ` +
        "referenced during render. Make sure that this property is reactive, " +
        "either in the data option, or for class-based components, by " +
        "initializing the property. " +
        "See: https://vuejs.org/v2/guide/reactivity.html#Declaring-Reactive-Properties.",
      target
    );
  };

  const warnReservedPrefix = (target, key) => {
    warn(
      `Property "${key}" must be accessed with "$data.${key}" because ` +
        'properties starting with "$" or "_" are not proxied in the Vue instance to ' +
        "prevent conflicts with Vue internals. " +
        "See: https://vuejs.org/v2/api/#data",
      target
    );
  };

  const hasProxy = typeof Proxy !== "undefined" && isNative(Proxy);

  if (hasProxy) {
    const isBuiltInModifier = makeMap(
      "stop,prevent,self,ctrl,shift,alt,meta,exact"
    );
    config.keyCodes = new Proxy(config.keyCodes, {
      set(target, key, value) {
        if (isBuiltInModifier(key)) {
          warn(
            `Avoid overwriting built-in modifier in config.keyCodes: .${key}`
          );
          return false;
        } else {
          target[key] = value;
          return true;
        }
      },
    });
  }

  const hasHandler = {
    has(target, key) {
      // 首先使用 in 操作符判断该属性是否在 vm 实例上存在
      const has = key in target;

      // 判断属性是否可用：当是 特殊属性(Number,Array等) 或者 下划线开头的且不在$data中的字符串 则为可用
      const isAllowed =
        allowedGlobals(key) ||
        (typeof key === "string" &&
          key.charAt(0) === "_" &&
          !(key in target.$data));

      // 如果属性在 vm 中不存在，且属性不可用，则抛出警告
      if (!has && !isAllowed) {
        if (key in target.$data) warnReservedPrefix(target, key);
        else warnNonPresent(target, key);
      }

      // 返回 has || !isAllowed，!isAllowed 表示如果属性不可用的话就当成属性存在
      return has || !isAllowed;
    },
  };

  /**
   *  主要作用当读取代理对象的属性时，如果属性不在真实的 vm 实例中，针对不同的情况抛出警告

      情况一：key 不在 vm 中，但是在 vm.$data 中，说明我们自定义的数据以 $ 或 _ 开头，这种情况是不会被数据代理，也就是直接通过 this.$xx 访问会得到 undefined

      情况二：确实不在 vm 中，就抛出一个警告
   */
  const getHandler = {
    get(target, key) {
      if (typeof key === "string" && !(key in target)) {
        if (key in target.$data) warnReservedPrefix(target, key);
        else warnNonPresent(target, key);
      }
      return target[key];
    },
  };

  /**
   * 首先判断浏览器是否支持 Proxy，如果支持的话，判断 _withStripped 属性
    _withStripped 为真：Proxy handler 采用 getHandler 方法
    _withStripped 为假：Proxy handler 采用 hasHandler 方法。
    不支持的话直接将 vm 赋值给 _renderProxy

    为什么根据 _withStripped 来使用hasHandler或getHandler呢? 在这之前，我们先明确两点，当 proxy.foo 访问时会触发 Proxy 的 get，当 with(proxy) { (foo); } 会触发 Proxy 的 has

    1. 对于非单文件组件，使用 el 或者 templete 来创建组件的方式，vue 会解析 template 生成 render
    vm.$options.render = function () {
      with (this) {
        // 这里的 _c 是 vm._c，下文有介绍
        return _c(...)
      }
    }
    我们访问 _c 会触发 Proxy 的 has，也就是上面的 hasHandler

    2. 但是对于 单文件组件(SFC) 而言，vue-loader 工具将 template 编译成严格模式下是不包含 with 的代码，但是会为编译后的 render 设置 render._withStripped = true，问题，编译后的 render 长这样
    var render = function() {
        var _vm = this;
        var _h = _vm.$createElement;
        var _c = _vm._self._c || _h;
        return _c(...)
    }

    这时我们通过 _vm.xx 的形式访问属性，则会触发 Proxy 的 get，也就是 getHandler
   */
  initProxy = function initProxy(vm) {
    if (hasProxy) {
      // determine which proxy handler to use
      const options = vm.$options;

      // 根据 _withStripped 来决定使用哪个 proxy handler
      const handlers =
        options.render && options.render._withStripped
          ? getHandler
          : hasHandler;
      vm._renderProxy = new Proxy(vm, handlers);
    } else {
      vm._renderProxy = vm;
    }
  };
}

export { initProxy };

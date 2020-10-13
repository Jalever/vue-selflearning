/* @flow */

import { hasOwn } from "shared/util";
import { warn, hasSymbol } from "../util/index";
import { defineReactive, toggleObserving } from "../observer/index";

// 使用场景：由于vue有$parent属性可以让子组件访问父组件。但孙组件想要访问祖先组件就比较困难。通过provide/inject可以轻松实现跨级访问祖先组件的数据

// initProvide方法则是初始化provide的值，并赋值给_provided属性。provide属性可以是一个基本类型，也可以是一个function
export function initProvide(vm: Component) {
  const provide = vm.$options.provide;
  if (provide) {
    vm._provided = typeof provide === "function" ? provide.call(vm) : provide;
  }
}

export function initInjections(vm: Component) {
  // 首先通过 resolveInject 方法获取 inject 选项搜索结果，如果有搜索结果，遍历搜索结果并为其中的数据添加 setter 和 getter
  const result = resolveInject(vm.$options.inject, vm);

  if (result) {
    toggleObserving(false);

    Object.keys(result).forEach((key) => {
      /* istanbul ignore else */
      if (process.env.NODE_ENV !== "production") {
        defineReactive(vm, key, result[key], () => {
          warn(
            `Avoid mutating an injected value directly since the changes will be ` +
              `overwritten whenever the provided component re-renders. ` +
              `injection being mutated: "${key}"`,
            vm
          );
        });
      } else {
        defineReactive(vm, key, result[key]);
      }
    });
    toggleObserving(true);
  }
}

export function resolveInject(inject: any, vm: Component): ?Object {
  if (inject) {
    // inject is :any because flow is not smart enough to figure out cached
    const result = Object.create(null);

    // 获取 inject 选项的 key 数组
    const keys = hasSymbol ? Reflect.ownKeys(inject) : Object.keys(inject);

    for (let i = 0; i < keys.length; i++) {
      /**
       * 遍历 key 数组，通过向上冒泡来查找 provide 中是否有 key 与 inject 选项中 from 属性同名的
       * 如果有，则将这个数据传递给 result；
       * 如果没有，检查 inject 是否有 default 选项设定默认值或者默认方法，如果有则将默认值返传给 result，最终返回 result 对象。
       * 所以，inject 的写法应该是有 default 默认值的：

        const Child = {
          inject: {
            foo: { default: 'foo' }
          }
        }

        或者是有 from 查找键和 default 默认值的
        
        const Child = {
          inject: {
            foo: {
              from: 'bar',
              default: 'foo'
            }
          }
        }：

        或者为 default 默认值设定一个工厂方法：

        const Child = {
          inject: {
            foo: {
              from: 'bar',
              default: () => [1, 2, 3]
            }
          }
        }
       */
      const key = keys[i];
      // #6574 in case the inject object is observed...
      if (key === "__ob__") continue;
      const provideKey = inject[key].from;
      let source = vm;
      while (source) {
        if (source._provided && hasOwn(source._provided, provideKey)) {
          result[key] = source._provided[provideKey];
          break;
        }
        source = source.$parent;
      }

      if (!source) {
        if ("default" in inject[key]) {
          const provideDefault = inject[key].default;
          result[key] =
            typeof provideDefault === "function"
              ? provideDefault.call(vm)
              : provideDefault;
        } else if (process.env.NODE_ENV !== "production") {
          warn(`Injection "${key}" not found`, vm);
        }
      }
    }
    return result;
  }
}

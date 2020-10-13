/* @flow */

import {
  tip,
  toArray,
  hyphenate,
  formatComponentName,
  invokeWithErrorHandling,
} from "../util/index";
import { updateListeners } from "../vdom/helpers/index";

export function initEvents(vm: Component) {
  // vm._events表示的是父组件绑定在当前组件上的事件
  vm._events = Object.create(null);

  // 该属性表示父组件是否通过"@hook:"把钩子函数绑定在当前组件上
  /**
   * <child
      @hook:created="hookFromParent"
      @hover="hoverFromParent"
      :msg-from-father="msg" 
      :hit-from-father="hit"
    >
   */
  vm._hasHookEvent = false;

  // init parent attached events
  /**
   * 与vm._events一样，都是表示父组件绑定到当前组件中的方法，但略有不同
   */
  const listeners = vm.$options._parentListeners;
  if (listeners) {
    updateComponentListeners(vm, listeners);
  }
}

let target: any;

function add(event, fn) {
  target.$on(event, fn);
}

function remove(event, fn) {
  target.$off(event, fn);
}

function createOnceHandler(event, fn) {
  const _target = target;
  return function onceHandler() {
    const res = fn.apply(null, arguments);
    if (res !== null) {
      _target.$off(event, onceHandler);
    }
  };
}

export function updateComponentListeners(
  vm: Component,
  listeners: Object,
  oldListeners: ?Object
) {
  target = vm;

  /**
   * listeners我们前面说过，是父组件绑定在当前组件上的事件对象，oldListeners表示当前组件上旧的事件对象，vm是vue实例对象
   */
  updateListeners(
    listeners,
    oldListeners || {},
    add,
    remove,
    createOnceHandler,
    vm
  );

  target = undefined;
}

export function eventsMixin(Vue: Class<Component>) {
  const hookRE = /^hook:/;

  /**
   * 监听当前实例上的自定义事件
   * 事件可以由vm.$emit触发
   * 回调函数会接收所有传入事件触发函数的额外参数
   * 作用：vm.on方法主要就是把传入的方法给push到_events属性里,方便之后被emit调用。
   */
  Vue.prototype.$on = function (
    event: string | Array<string>,
    fn: Function
  ): Component {
    const vm: Component = this;

    if (Array.isArray(event)) {
      for (let i = 0, l = event.length; i < l; i++) {
        vm.$on(event[i], fn);
      }
    } else {
      /**
       * _events是表示直接绑定在组件上的事件
       */
      (vm._events[event] || (vm._events[event] = [])).push(fn);

      // optimize hook:event cost by using a boolean flag marked at registration
      // instead of a hash lookup
      /**
       * 如果是下列形式绑定的钩子，则_hasHookEvent属性为true
       * <child
            @hook:created="hookFromParent"
          >
          像下面这种形式，它也存在钩子函数，但是它的_hasHookEvent就是false
          const childComponent = Vue.component('child', {
            ...
            created () {
              console.log('child created')
            }
          })
       */
      if (hookRE.test(event)) {
        // 表示的是父组件有没有直接绑定钩子函数在当前组件上
        vm._hasHookEvent = true;
      }
    }

    return vm;
  };

  /**
   * 监听一个自定义事件，但是只触发一次，在第一次触发之后移除监听器
   */
  Vue.prototype.$once = function (event: string, fn: Function): Component {
    const vm: Component = this;

    /**
     * on方法包装了event的回调事件，这是on和once最本质的区别，当触发once绑定的回调时候，执行on方法，先调用$off方法（这个方法是移除监听的方法，我们待会儿就会讲）移除监听，然后再执行回调函数。这样就实现了只触发一次的功能
     */
    function on() {
      vm.$off(event, on);
      fn.apply(vm, arguments);
    }

    on.fn = fn;
    vm.$on(event, on);
    return vm;
  };

  Vue.prototype.$off = function (
    event?: string | Array<string>,
    fn?: Function
  ): Component {

    const vm: Component = this;

    // 如果没有传参数，则清空所有事件的监听函数
    if (!arguments.length) {
      vm._events = Object.create(null);
      return vm;
    }

    // 如果传的event是数组，则对该数组里的每个事件再递归调用$off方法
    if (Array.isArray(event)) {
      for (let i = 0, l = event.length; i < l; i++) {
        vm.$off(event[i], fn);
      }
      return vm;
    }

    // specific event
    const cbs = vm._events[event];

    // 如果不存在回调函数，则直接返回，因为没有可以移除监听的内容
    if (!cbs) {
      return vm;
    }

    // 如果没有指定要移除的回调函数，则移除该事件下所有的回调函数
    if (!fn) {
      vm._events[event] = null;
      return vm;
    }

    // 指定了要移除的回调函数
    let cb;
    let i = cbs.length;
    while (i--) {
      cb = cbs[i];
      // 在事件对应的回调函数数组里面找出要移除的回调函数，并从数组里移除
      if (cb === fn || cb.fn === fn) {
        cbs.splice(i, 1);
        break;
      }
    }
    return vm;
  };

  Vue.prototype.$emit = function (event: string): Component {
    const vm: Component = this;
    if (process.env.NODE_ENV !== "production") {
      const lowerCaseEvent = event.toLowerCase();
      if (lowerCaseEvent !== event && vm._events[lowerCaseEvent]) {
        tip(
          `Event "${lowerCaseEvent}" is emitted in component ` +
            `${formatComponentName(
              vm
            )} but the handler is registered for "${event}". ` +
            `Note that HTML attributes are case-insensitive and you cannot use ` +
            `v-on to listen to camelCase events when using in-DOM templates. ` +
            `You should probably use "${hyphenate(
              event
            )}" instead of "${event}".`
        );
      }
    }
    
    // 拿出触发事件对应的回调函数列表
    let cbs = vm._events[event];
    if (cbs) {
      cbs = cbs.length > 1 ? toArray(cbs) : cbs;
      
      // $emit方法可以传参，这些参数会在调用回调函数的时候传进去
      const args = toArray(arguments, 1);
      const info = `event handler for "${event}"`;
      
      // 遍历回调函数列表，调用每个回调函数
      for (let i = 0, l = cbs.length; i < l; i++) {
        invokeWithErrorHandling(cbs[i], vm, args, vm, info);
      }
    }
    return vm;
  };
}

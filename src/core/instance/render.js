/* @flow */

import {
  warn,
  nextTick,
  emptyObject,
  handleError,
  defineReactive,
} from "../util/index";

import { createElement } from "../vdom/create-element";
import { installRenderHelpers } from "./render-helpers/index";
import { resolveSlots } from "./render-helpers/resolve-slots";
import { normalizeScopedSlots } from "../vdom/helpers/normalize-scoped-slots";
import VNode, { createEmptyVNode } from "../vdom/vnode";
import { isUpdatingChildComponent } from "./lifecycle";

export function initRender(vm: Component) {
  vm._vnode = null; // the root of the child tree
  vm._staticTrees = null; // v-once cached trees

  const options = vm.$options;
  // the placeholder node in parent tree
  const parentVnode = (vm.$vnode = options._parentVnode);
  const renderContext = parentVnode && parentVnode.context;
  vm.$slots = resolveSlots(options._renderChildren, renderContext);
  vm.$scopedSlots = emptyObject;

  /**
   * 上述主要是在Vue当前实例对象上添加了三个实例属性:
   * vm.$vnode
     vm.$slots
     vm.$scopedSlots
   */

  // vm._c 和 vm.$createElement 的不同之处就在于调用 createElement 函数时传递的第六个参数不同
  // vm._c 是内部函数，它是被模板编译成的 render 函数使用
  // bind the createElement fn to this instance
  // so that we get proper render context inside it.
  // args order: tag, data, children, normalizationType, alwaysNormalize
  // internal version is used by render functions compiled from templates
  vm._c = (a, b, c, d) => createElement(vm, a, b, c, d, false);

  // normalization is always applied for the public version, used in
  // user-written render functions.
  // vm.$createElement 是提供给用户编写的 render 函数使用的
  vm.$createElement = (a, b, c, d) => createElement(vm, a, b, c, d, true);

  // $attrs & $listeners are exposed for easier HOC creation.
  // they need to be reactive so that HOCs using them are always updated
  const parentData = parentVnode && parentVnode.data;

  /* istanbul ignore else */
  /**
   * 在 Vue 实例对象上定义两个属性：vm.$attrs 以及 vm.$listeners
   */
  if (process.env.NODE_ENV !== "production") {
    /**
      obj: Object,
      key: string,
      val: any,
      customSetter?: ?Function,
      shallow?: boolean

      在非生产环境中调用 defineReactive 函数时传递的第四个参数是一个函数，实际上这个函数是一个自定义的 setter，这个 setter 会在你设置 $attrs 或 $listeners 属性时触发并执行
     */
    defineReactive(
      vm,
      "$attrs",
      (parentData && parentData.attrs) || emptyObject,
      () => {
        !isUpdatingChildComponent && warn(`$attrs is readonly.`, vm);
      },
      true
    );

    defineReactive(
      vm,
      "$listeners",
      options._parentListeners || emptyObject,
      () => {
        !isUpdatingChildComponent && warn(`$listeners is readonly.`, vm);
      },
      true
    );
  } else {
    defineReactive(
      vm,
      "$attrs",
      (parentData && parentData.attrs) || emptyObject,
      null,
      true
    );

    defineReactive(
      vm,
      "$listeners",
      options._parentListeners || emptyObject,
      null,
      true
    );
  }
}

export let currentRenderingInstance: Component | null = null;

// for testing only
export function setCurrentRenderingInstance(vm: Component) {
  currentRenderingInstance = vm;
}

export function renderMixin(Vue: Class<Component>) {
  // install runtime convenience helpers
  installRenderHelpers(Vue.prototype);

  Vue.prototype.$nextTick = function (fn: Function) {
    return nextTick(fn, this);
  };

  // 作用: vm._render 生成 VNode
  /**
   * 核心逻辑就是调用了 render 函数，传入 vm.$createElement 参数，然后将 this 绑定为 vm._renderProxy，最终返回一个 vnode
   * new Vue => _init => $mount => compile => render => vNode => patch => DOM
   */
  Vue.prototype._render = function (): VNode {
    const vm: Component = this;
    const { render, _parentVnode } = vm.$options;

    // slot相关逻辑
    if (_parentVnode) {
      vm.$scopedSlots = normalizeScopedSlots(
        _parentVnode.data.scopedSlots,
        vm.$slots,
        vm.$scopedSlots
      );
    }

    // set parent vnode. this allows render functions to have access
    // to the data on the placeholder node.
    // 允许 render 函数能访问到占位符vnode 的 data 数据
    vm.$vnode = _parentVnode;
    // render self
    let vnode;

    try {
      // There's no need to maintain a stack because all render fns are called
      // separately from one another. Nested component's render fns are called
      // when parent component is patched.
      // 无需维护一个栈，因为所有的 render 函数是彼此分开调用的
      // 嵌套组件的 render 函数在父组件 patched 时被调用
      currentRenderingInstance = vm;

      // 核心：调用 render 函数
      vnode = render.call(vm._renderProxy, vm.$createElement);
    } catch (e) {
      handleError(e, vm, `render`);
      // return error render result,
      // or previous vnode to prevent render error causing blank component
      /* istanbul ignore else */
      if (process.env.NODE_ENV !== "production" && vm.$options.renderError) {
        try {
          vnode = vm.$options.renderError.call(
            vm._renderProxy,
            vm.$createElement,
            e
          );
        } catch (e) {
          handleError(e, vm, `renderError`);
          vnode = vm._vnode;
        }
      } else {
        vnode = vm._vnode;
      }
    } finally {
      currentRenderingInstance = null;
    }

    // if the returned array contains only a single node, allow it
    if (Array.isArray(vnode) && vnode.length === 1) {
      vnode = vnode[0];
    }

    // return empty vnode in case the render function errored out
    if (!(vnode instanceof VNode)) {
      if (process.env.NODE_ENV !== "production" && Array.isArray(vnode)) {
        warn(
          "Multiple root nodes returned from render function. Render function " +
            "should return a single root node.",
          vm
        );
      }
      vnode = createEmptyVNode();
    }

    // set parent
    vnode.parent = _parentVnode;
    return vnode;
  };
}

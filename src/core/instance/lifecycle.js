/* @flow */

import config from "../config";
import Watcher from "../observer/watcher";
import { mark, measure } from "../util/perf";
import { createEmptyVNode } from "../vdom/vnode";
import { updateComponentListeners } from "./events";
import { resolveSlots } from "./render-helpers/resolve-slots";
import { toggleObserving } from "../observer/index";
import { pushTarget, popTarget } from "../observer/dep";

import {
  warn,
  noop,
  remove,
  emptyObject,
  validateProp,
  invokeWithErrorHandling,
} from "../util/index";

// activeInstance:当前Vue或者组件实例，作为一个全局变量，主要维护组件树对应的实例对象的父子关系
export let activeInstance: any = null;

/**
 * 在render.js文件中定义$attrs和$listeners时，判断是否需要提示$attrs和$listeners是否是只读属性
 */
export let isUpdatingChildComponent: boolean = false;

/**
 *
 * 把之前的实例对象存起来，再设置成最新调用update的实例。在patch完后就恢复原来的实例
 */
export function setActiveInstance(vm: Component) {
  const prevActiveInstance = activeInstance;
  activeInstance = vm;
  return () => {
    activeInstance = prevActiveInstance;
  };
}

export function initLifecycle(vm: Component) {
  // 把mergeOptions后的options赋值给options变量
  const options = vm.$options;

  /**
   * 定位第一个"非抽象"的父组件[locate first non-abstract parent]
   */
  // 如果当前vm实例存在父实例，则把父实例赋值给parent变量
  let parent = options.parent;
  // 当父实例存在，且该实例不是抽象组件，则执行下面代码
  if (parent && !options.abstract) {
    // 如果父实例parent是抽象组件，则继续找parent上的parent，
    // 直到找到非抽象组件为止
    while (parent.$options.abstract && parent.$parent) {
      parent = parent.$parent;
    }

    // 之后把当前vm实例push到定位的第一个非抽象parent的$children属性上，现在我们知道了怎么匹配vm实例上的parent属性
    parent.$children.push(vm);
  }

  // 指定已创建的实例之父实例，在两者之间建立父子关系。子实例可以用 this.parent 访问父实例，子实例被推入父实例的children 数组中
  vm.$parent = parent;

  // 当前组件树的根 Vue 实例。如果当前实例没有父实例，此实例将会是其自己
  vm.$root = parent ? parent.$root : vm;

  // 当前实例的直接子组件。需要注意 $children 并不保证顺序，也不是响应式的
  vm.$children = [];

  // 一个对象，持有已注册过 ref 的所有子组件
  vm.$refs = {};

  // 组件实例相应的 watcher 实例对象
  vm._watcher = null;

  //表示keep-alive中组件状态，如被激活，该值为false,反之为true
  vm._inactive = null;

  // 也是表示keep-alive中组件状态的属性
  vm._directInactive = false;

  // 当前实例是否完成挂载(对应生命周期图示中的mounted)
  vm._isMounted = false;

  // 当前实例是否已经被销毁(对应生命周期图示中的destroyed)
  vm._isDestroyed = false;

  // 当前实例是否正在被销毁,还没有销毁完成(介于生命周期图示中beforeDestroy和destroyed之间)
  vm._isBeingDestroyed = false;
}

// 生命周期的开始除了设置了相关属性的初始值之外，还为类原型对象挂载了一些方法，包括私有的更新组件的方法和公用的生命周期相关的方法。这些方法都包含在 lifecycleMixin 函数中
export function lifecycleMixin(Vue: Class<Component>) {
  Vue.prototype._update = function (vnode: VNode, hydrating?: boolean) {
    const vm: Component = this;
    const prevEl = vm.$el;
    const prevVnode = vm._vnode;
    const restoreActiveInstance = setActiveInstance(vm);

    // 将传入的vnode赋值给实例的_vnode属性
    // vnode是新生成的虚拟节点数，这里把它储存起来覆盖
    vm._vnode = vnode;

    // Vue.prototype.__patch__ is injected in entry points
    // based on the rendering backend used.
    // 如果prevVnode属性不存在说明是新创建实例
    // 执行实例属性$el的初始化渲染，否则更新节点
    if (!prevVnode) {
      // 如果旧的虚拟节点不存在则调用patch方法
      // 传入挂载的真实DOM节点和新生成的虚拟节点
      // initial render
      vm.$el = vm.__patch__(vm.$el, vnode, hydrating, false /* removeOnly */);
    } else {
      // 否则执行虚拟节点更新操作，传入的是新旧虚拟节点
      // updates
      vm.$el = vm.__patch__(prevVnode, vnode);
    }

    restoreActiveInstance();

    // 更新__vue__属性的引用
    // update __vue__ reference
    // 如果存在旧元素则设置它的__vue__引用为null
    // update __vue__ reference
    if (prevEl) {
      prevEl.__vue__ = null;
    }

    // 如果实例的$el属性存在，设置它的__vue__引用为该实例
    if (vm.$el) {
      vm.$el.__vue__ = vm;
    }

    // 如果父节点是一个高阶组件，也更新它的元素节点
    // if parent is an HOC, update its $el as well
    if (vm.$vnode && vm.$parent && vm.$vnode === vm.$parent._vnode) {
      vm.$parent.$el = vm.$el;
    }
    // updated hook is called by the scheduler to ensure that children are
    // updated in a parent's updated hook.
  };

  //调用_watcher，强制更新一遍
  Vue.prototype.$forceUpdate = function () {
    const vm: Component = this;
    if (vm._watcher) {
      vm._watcher.update();
    }
  };

  // 为Vue实例挂载$destroy方法
  Vue.prototype.$destroy = function () {
    const vm: Component = this;

    // 如果实例已经在销毁中，则返回
    if (vm._isBeingDestroyed) {
      return;
    }

    // 调用beforeDestroy钩子
    callHook(vm, "beforeDestroy");

    // 给实例设置正在销毁中的标志
    vm._isBeingDestroyed = true;

    // remove self from parent
    const parent = vm.$parent;

    // 如果非抽象父级组件存在且没有在销毁中，则从父组件中移除实例
    if (parent && !parent._isBeingDestroyed && !vm.$options.abstract) {
      remove(parent.$children, vm);
    }

    // 销毁所有观察器
    // teardown watchers
    if (vm._watcher) {
      vm._watcher.teardown();
    }
    let i = vm._watchers.length;
    while (i--) {
      vm._watchers[i].teardown();
    }

    // 移除对象引用
    // remove reference from data ob
    // frozen object may not have observer.
    if (vm._data.__ob__) {
      vm._data.__ob__.vmCount--;
    }

    // call the last hook...
    // 设置实例的已销毁标志
    vm._isDestroyed = true;

    // 调用当前渲染树上的销毁钩子
    // invoke destroy hooks on current rendered tree
    vm.__patch__(vm._vnode, null);

    // 触发销毁钩子
    // fire destroyed hook
    callHook(vm, "destroyed");

    // turn off all instance listeners.
    // 清除所有监听事件
    vm.$off();

    // 移除实例引用
    // remove __vue__ reference
    if (vm.$el) {
      vm.$el.__vue__ = null;
    }

    // 释放循环引用
    // release circular reference (#6759)
    if (vm.$vnode) {
      vm.$vnode.parent = null;
    }
  };
}

export function mountComponent(
  vm: Component,
  el: ?Element,
  hydrating?: boolean
): Component {
  // 对 el 进行缓存
  vm.$el = el;

  /**
   * 判断 vm.$options.render 是否存在，如果不存在的话就让它等于 createEmptyVNode
   * 如果没有render函数，包括 template 没有正确的转换成render函数，就执行 if 语句
   */
  if (!vm.$options.render) {
    vm.$options.render = createEmptyVNode;
    if (process.env.NODE_ENV !== "production") {
      /* istanbul ignore if */
      if (
        (vm.$options.template && vm.$options.template.charAt(0) !== "#") ||
        vm.$options.el ||
        el
      ) {
        warn(
          "You are using the runtime-only build of Vue where the template " +
            "compiler is not available. Either pre-compile the templates into " +
            "render functions, or use the compiler-included build.",
          vm
        );
      } else {
        warn(
          "Failed to mount component: template or render function not defined.",
          vm
        );
      }
    }
  }

  callHook(vm, "beforeMount");

  let updateComponent;

  /* istanbul ignore if */
  if (process.env.NODE_ENV !== "production" && config.performance && mark) {
    updateComponent = () => {
      const name = vm._name;
      const id = vm._uid;
      const startTag = `vue-perf-start:${id}`;
      const endTag = `vue-perf-end:${id}`;

      mark(startTag);
      const vnode = vm._render();
      mark(endTag);
      measure(`vue ${name} render`, startTag, endTag);

      mark(startTag);
      vm._update(vnode, hydrating);
      mark(endTag);
      measure(`vue ${name} patch`, startTag, endTag);
    };
  } else {
    // updateComponent 其实是先调用 vm._render 生成 VNode，最终调用 vm._update 更新 DOM
    updateComponent = () => {
      // vm._render() 方法渲染出来一个 VNode
      // hydrating 跟服务端渲染相关，如果没有启用的话，其为 false
      // 当收集好了依赖之后，会通过 Watcher 的 this.getter(vm, vm) 来调用 updateComponent() 方法
      // 在这个方法里有两个方法需要调用：vm._render() and vm._update(),先调用 _render 方法生成一个vnode，然后将这个vnode传入到 _update()方法中
      vm._update(vm._render(), hydrating);
    };
  }

  // we set this to vm._watcher inside the watcher's constructor
  // since the watcher's initial patch may call $forceUpdate (e.g. inside child
  // component's mounted hook), which relies on vm._watcher being already defined
  /**
   * 渲染watcher，Watcher 在这里起到两个作用，一个是初始化的时候会执行回调函数，另一个是当 vm 实例中的监测的数据发生变化的时候执行回调函数
   * 在Watcher的构造函数中定义了getter函数：this.getter = expOrFn。这个expOrFn 是updateComponent方法，在Watcher.prototype.get()方法中通过this.getter.call(vm, vm)来调用updateComponent方法，然后执行vm._update(vm._render, hydrating)
   */
  new Watcher(
    vm,
    updateComponent,
    noop,
    {
      before() {
        if (vm._isMounted && !vm._isDestroyed) {
          callHook(vm, "beforeUpdate");
        }
      },
    },
    true /* isRenderWatcher */
  );

  hydrating = false;

  // manually mounted instance, call mounted on self
  // mounted is called for render-created child components in its inserted hook
  if (vm.$vnode == null) {
    vm._isMounted = true;
    callHook(vm, "mounted");
  }
  return vm;
}

export function updateChildComponent(
  vm: Component,
  propsData: ?Object,
  listeners: ?Object,
  parentVnode: MountedComponentVNode,
  renderChildren: ?Array<VNode>
) {
  if (process.env.NODE_ENV !== "production") {
    isUpdatingChildComponent = true;
  }

  // determine whether component has slot children
  // we need to do this before overwriting $options._renderChildren.

  // check if there are dynamic scopedSlots (hand-written or compiled but with
  // dynamic slot names). Static scoped slots compiled from template has the
  // "$stable" marker.
  const newScopedSlots = parentVnode.data.scopedSlots;
  const oldScopedSlots = vm.$scopedSlots;
  const hasDynamicScopedSlot = !!(
    (newScopedSlots && !newScopedSlots.$stable) ||
    (oldScopedSlots !== emptyObject && !oldScopedSlots.$stable) ||
    (newScopedSlots && vm.$scopedSlots.$key !== newScopedSlots.$key)
  );

  // Any static slot children from the parent may have changed during parent's
  // update. Dynamic scoped slots may also have changed. In such cases, a forced
  // update is necessary to ensure correctness.
  const needsForceUpdate = !!(
    renderChildren || // has new static slots
    vm.$options._renderChildren || // has old static slots
    hasDynamicScopedSlot
  );

  vm.$options._parentVnode = parentVnode;
  vm.$vnode = parentVnode; // update vm's placeholder node without re-render

  if (vm._vnode) {
    // update child tree's parent
    vm._vnode.parent = parentVnode;
  }
  vm.$options._renderChildren = renderChildren;

  // update $attrs and $listeners hash
  // these are also reactive so they may trigger child update if the child
  // used them during render
  vm.$attrs = parentVnode.data.attrs || emptyObject;
  vm.$listeners = listeners || emptyObject;

  // update props
  if (propsData && vm.$options.props) {
    toggleObserving(false);
    const props = vm._props;
    const propKeys = vm.$options._propKeys || [];
    for (let i = 0; i < propKeys.length; i++) {
      const key = propKeys[i];
      const propOptions: any = vm.$options.props; // wtf flow?
      props[key] = validateProp(key, propOptions, propsData, vm);
    }
    toggleObserving(true);
    // keep a copy of raw propsData
    vm.$options.propsData = propsData;
  }

  // update listeners
  listeners = listeners || emptyObject;
  const oldListeners = vm.$options._parentListeners;
  vm.$options._parentListeners = listeners;
  updateComponentListeners(vm, listeners, oldListeners);

  // resolve slots + force update if has children
  if (needsForceUpdate) {
    vm.$slots = resolveSlots(renderChildren, parentVnode.context);
    vm.$forceUpdate();
  }

  if (process.env.NODE_ENV !== "production") {
    isUpdatingChildComponent = false;
  }
}

function isInInactiveTree(vm) {
  while (vm && (vm = vm.$parent)) {
    if (vm._inactive) return true;
  }
  return false;
}

export function activateChildComponent(vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = false;
    if (isInInactiveTree(vm)) {
      return;
    }
  } else if (vm._directInactive) {
    return;
  }
  if (vm._inactive || vm._inactive === null) {
    vm._inactive = false;
    for (let i = 0; i < vm.$children.length; i++) {
      activateChildComponent(vm.$children[i]);
    }
    callHook(vm, "activated");
  }
}

export function deactivateChildComponent(vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = true;
    if (isInInactiveTree(vm)) {
      return;
    }
  }
  if (!vm._inactive) {
    vm._inactive = true;
    for (let i = 0; i < vm.$children.length; i++) {
      deactivateChildComponent(vm.$children[i]);
    }
    callHook(vm, "deactivated");
  }
}

/**
 * 作用: 执行用户自定义的钩子函数，并将钩子中this指向指为当前组件实例
 * let test = new Vue({
    data: {
      a: 1
    },
    created: function () {
      console.log("这里是Created");
    }
  });
  实例化一个Vue组件test,给test定义了数据data，以及created方法。而在实例化组件的时候，Vue内部调用了callHook(vm,'created')（上文已说明）。执行callHook函数的时候，Vue在test组件的$options中查找created是否存在，如果存在的话就执行created相对应的方法。这里就会执行console.log("这里是Created")
 */
export function callHook(vm: Component, hook: string) {
  // #7573 disable dep collection when invoking lifecycle hooks
  pushTarget();

  const handlers = vm.$options[hook];
  const info = `${hook} hook`;

  if (handlers) {
    for (let i = 0, j = handlers.length; i < j; i++) {
      invokeWithErrorHandling(handlers[i], vm, null, vm, info);
    }
  }

  /**
   * Vue.prototype.$on中有关联
   * 当前实例的钩子函数如果是通过父组件的:hook方式来指定的，那么它在执行钩子函数的回调方法时就是直接触发vm.$emit来执行。（这种方式类似于dom中的addEventListener监听事件和dispatchEvent触发事件）
   */
  if (vm._hasHookEvent) {
    vm.$emit("hook:" + hook);
  }
  
  popTarget();
}

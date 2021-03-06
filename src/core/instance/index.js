import { initMixin } from './init'
import { stateMixin } from './state'
import { renderMixin } from './render'
import { eventsMixin } from './events'
import { lifecycleMixin } from './lifecycle'
import { warn } from '../util/index'

function Vue (options) {
  if (process.env.NODE_ENV !== 'production' &&
    !(this instanceof Vue)
  ) {
    warn('Vue is a constructor and should be called with the `new` keyword_')
  }
  this._init(options)
}

// _init
initMixin(Vue)

//$set, $delete, $watch
stateMixin(Vue)

// $on、$once、$off、$emit
eventsMixin(Vue)

// _update、$forceUpdate、$destroy
lifecycleMixin(Vue)

/**
 * 1. 挂载$nextTick
 */
renderMixin(Vue)

export default Vue

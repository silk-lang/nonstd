import { Runtime } from 'foldkit'
import { ModelSchema, init, update } from './main'
import { view } from './view'
import './style.css'

const application = Runtime.makeApplication({
  Model: ModelSchema,
  init,
  update,
  view,
  // Recording large selection diffs is expensive; opt in when debugging state.
  devTools: new URLSearchParams(location.search).has('debug') ? { show: 'Always' } : false,
  container: document.querySelector('#root'),
})
Runtime.run(application)

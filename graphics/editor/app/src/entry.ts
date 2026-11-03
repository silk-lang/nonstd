import { Runtime } from 'foldkit'
import { ModelSchema, init, update } from './main'
import { view } from './view'
import './style.css'

const application = Runtime.makeApplication({
  Model: ModelSchema,
  init,
  update,
  view,
  container: document.querySelector('#root'),
})
Runtime.run(application)

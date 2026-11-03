import { starterDocument } from './starter'
import { type Command, type Runtime, type Update } from 'foldkit'
import { currentPage, descendants } from './document'
import { SyncCanvas } from './engine'
import {
  ExportDocument,
  ImportDocument,
  ListDocuments,
  NewDocument,
  OpenDocument,
  SaveDocument,
} from './files'
import { Messages, ModelSchema, type Message, type Model } from './model'
import { initialModel, reduce } from './update'

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: initialModel({ ...starterDocument(), id: crypto.randomUUID() }),
  commands: [OpenDocument({ id: '' }), ListDocuments()],
})
export const update = (model: Model, message: Message): Update.Return<Model, Message> => {
  let next = reduce(model, message)
  const commands: Command.Command<Message>[] = []
  if (message._tag === 'Action') {
    if (message.action === 'new') {
      next = { ...model, menu: 'none' }
      commands.push(NewDocument())
    }
    if (message.action === 'import') {
      next = { ...next, menu: 'none' }
      commands.push(ImportDocument())
    }
    if (message.action === 'documents') commands.push(ListDocuments())
    if (message.action.startsWith('export-')) {
      const format = message.action.slice(7)
      if (format === 'json' || format === 'svg' || format === 'png')
        commands.push(
          ExportDocument({
            document: next.document,
            format,
            selection: descendants(currentPage(next.document).nodes, next.selection).map(
              (n) => n.id,
            ),
          }),
        )
      next = { ...next, menu: 'none' }
    }
  }
  if (message._tag === 'OpenDocument') commands.push(OpenDocument({ id: message.id }))
  if (
    next.ready &&
    (next.document !== model.document || next.camera !== model.camera || message._tag === 'Ready')
  )
    commands.push(SyncCanvas({ page: currentPage(next.document), camera: next.camera }))
  if (next.revision !== model.revision || message._tag === 'Loaded')
    commands.push(SaveDocument({ document: next.document, revision: next.revision }))
  return { model: next, commands }
}
export { ModelSchema, Messages }
export type { Model, Message }

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import LunaModal from 'luna-modal/react'
import { t } from 'common/util'
import map from 'licia/map'
import Style from './CommandEditModal.module.scss'
import className from 'licia/className'
import { ICommandCategory, IShellCommand } from 'common/types'

interface ICommandEditModalProps {
  visible: boolean
  onClose: () => void
  onSave: (data: {
    title: string
    description: string
    command: string
    categoryId: string
  }) => void
  command: IShellCommand | null
  categories: ICommandCategory[]
}

export default function CommandEditModal(props: ICommandEditModalProps) {
  const { visible, onClose, onSave, command, categories } = props

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [commandText, setCommandText] = useState('')
  const [categoryId, setCategoryId] = useState('')

  useEffect(() => {
    if (visible) {
      if (command) {
        setTitle(command.title)
        setDescription(command.description)
        setCommandText(command.command)
        setCategoryId(command.categoryId)
      } else {
        setTitle('')
        setDescription('')
        setCommandText('')
        setCategoryId(categories.length > 0 ? categories[0].id : '')
      }
    }
  }, [visible, command, categories])

  function handleSave() {
    if (!title.trim() || !commandText.trim()) return
    onSave({
      title: title.trim(),
      description: description.trim(),
      command: commandText.trim(),
      categoryId,
    })
  }

  const isValid = title.trim() && commandText.trim()

  return createPortal(
    <LunaModal
      title={command ? t('editCommand') : t('addCommand')}
      width={400}
      visible={visible}
      onClose={onClose}
    >
      <div className={Style.form}>
        <div className={Style.field}>
          <label className={Style.label}>
            {t('commandTitle')}
            <span className={Style.requiredMark}>*</span>
          </label>
          <input
            className={Style.input}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('commandTitle')}
          />
        </div>
        <div className={Style.field}>
          <label className={Style.label}>{t('commandDesc')}</label>
          <input
            className={Style.input}
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('commandDesc')}
          />
        </div>
        <div className={Style.field}>
          <label className={Style.label}>
            {t('commandText')}
            <span className={Style.requiredMark}>*</span>
          </label>
          <textarea
            className={Style.textarea}
            value={commandText}
            onChange={(e) => setCommandText(e.target.value)}
            placeholder={t('commandText')}
            rows={3}
          />
        </div>
        <div className={Style.field}>
          <label className={Style.label}>{t('category')}</label>
          <select
            className={Style.select}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {map(categories, (cat) => (
              <option key={cat.id} value={cat.id}>
                {t(cat.name) || cat.name}
              </option>
            ))}
          </select>
        </div>
        <div className={Style.actions}>
          <button className={Style.btn} onClick={onClose}>
            {t('close')}
          </button>
          <button
            className={className(Style.btn, Style.primaryBtn)}
            onClick={handleSave}
            disabled={!isValid}
          >
            {t('save')}
          </button>
        </div>
      </div>
    </LunaModal>,
    document.body
  )
}

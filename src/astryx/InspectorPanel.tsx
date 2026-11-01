import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Drawer, DrawerHeader } from '@astryxdesign/core/Drawer'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Layout, LayoutContent, LayoutHeader, LayoutPanel } from '@astryxdesign/core/Layout'
import { List, ListItem } from '@astryxdesign/core/List'
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList'
import { MoreMenu } from '@astryxdesign/core/MoreMenu'
import { ResizeHandle, useResizable } from '@astryxdesign/core/Resizable'
import { Selector } from '@astryxdesign/core/Selector'
import { Slider } from '@astryxdesign/core/Slider'
import { StackItem } from '@astryxdesign/core/Stack'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Switch } from '@astryxdesign/core/Switch'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Token } from '@astryxdesign/core/Token'
import { Toolbar } from '@astryxdesign/core/Toolbar'
import { TreeList, type TreeListItemData } from '@astryxdesign/core/TreeList'
import { VStack } from '@astryxdesign/core/VStack'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { FileInput } from '@astryxdesign/core/FileInput'
import { Database, History, Pause, Play, SkipForward, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { formatPath } from '../diff'
import { downloadJson, stateFromImport } from '../files'
import { snapshotKey, type PanelModel, type PanelStoreData, type PanelTab } from '../model'
import { formatDelta, formatTime } from '../panel/format'
import type { ActionMeta, Change } from '../protocol'
import { childrenOf, describe, KeyValue, kindOf, summarize, ValueText } from './Value'

/*
 * Responsive contract (width of the devtools pane, measured by mount.tsx):
 *   >= 720  two regions: resizable action list (start panel) | action detail (content)
 *   <  720  one region: the action list; selecting an action opens the detail in a Drawer
 *   <  560  the filter leaves the toolbar for its own header row, Pause becomes icon-only
 */
const TWO_REGIONS_MIN = 720
const COMPACT_MAX = 560

export function InspectorPanel({ model, width }: { model: PanelModel; width: number }) {
  const data = useStore(model.store, (s) => (s.selectedStore ? s.stores[s.selectedStore] : undefined))
  const twoRegions = width === 0 || width >= TWO_REGIONS_MIN
  const compact = width > 0 && width < COMPACT_MAX
  const [drawerOpen, setDrawerOpen] = useState(false)
  const timelinePanel = useResizable({
    defaultSize: 360,
    minSize: 240,
    maxSize: 640,
    autoSaveId: 'zustand-inspector:timeline-width',
  })

  useEffect(() => model.onExport(downloadJson), [model])
  useEffect(() => {
    if (twoRegions) setDrawerOpen(false)
  }, [twoRegions])

  if (!data) {
    return (
      <Layout
        content={
          <LayoutContent label="Zustand inspector">
            <VStack height="100%" justify="center" align="center">
              <EmptyState
                isCompact
                icon={<Icon icon={Database} size="lg" color="secondary" />}
                title="No Zustand stores yet"
                description="Wrap a store with inspector(creator, { name }) or call inspectStore(store, { name }). It appears here as soon as it is created."
              />
            </VStack>
          </LayoutContent>
        }
      />
    )
  }

  const onSelect = (id: number) => {
    model.selectAction(id)
    if (!twoRegions) setDrawerOpen(true)
  }
  const timeline = <Timeline model={model} data={data} onSelect={onSelect} />

  return (
    <>
      <Layout
        header={<PanelHeader model={model} data={data} compact={compact} />}
        start={
          twoRegions ? (
            <>
              <LayoutPanel resizable={timelinePanel.props} padding={0} label="Actions">
                {timeline}
              </LayoutPanel>
              <ResizeHandle resizable={timelinePanel.props} hasDivider label="Resize the action list" />
            </>
          ) : undefined
        }
        content={
          twoRegions ? (
            <LayoutContent padding={0} isScrollable={false} label="Action detail">
              <Detail model={model} data={data} />
            </LayoutContent>
          ) : (
            <LayoutContent padding={0} label="Actions">
              {timeline}
            </LayoutContent>
          )
        }
      />
      {!twoRegions ? (
        <Drawer isOpen={drawerOpen} onOpenChange={setDrawerOpen} label="Action detail" width="92%">
          <Detail model={model} data={data} onClose={() => setDrawerOpen(false)} />
        </Drawer>
      ) : null}
    </>
  )
}

function statusOf(data: PanelStoreData): { variant: 'success' | 'warning' | 'accent'; label: string } {
  if (data.paused) return { variant: 'warning', label: 'Recording paused' }
  if (data.currentId !== data.actions.at(-1)?.id) return { variant: 'accent', label: 'Time travelling' }
  return { variant: 'success', label: 'Recording' }
}

function PanelHeader({ model, data, compact }: { model: PanelModel; data: PanelStoreData; compact: boolean }) {
  const order = useStore(model.store, (s) => s.order)
  const stores = useStore(model.store, (s) => s.stores)
  const filter = useStore(model.store, (s) => s.filter)
  const showFunctions = useStore(model.store, (s) => s.showFunctions)
  const [importOpen, setImportOpen] = useState(false)
  const status = statusOf(data)

  const filterInput = (
    <TextInput
      label="Filter actions"
      isLabelHidden
      size="sm"
      width={compact ? '100%' : 180}
      startIcon="search"
      placeholder="Filter actions"
      hasClear
      value={filter}
      onChange={(value) => model.setFilter(value)}
    />
  )

  return (
    <VStack gap={0}>
      <Toolbar
        label="Zustand inspector"
        size="sm"
        gap={2}
        dividers={['bottom']}
        startContent={
          <>
            <StatusDot variant={status.variant} label={status.label} tooltip={status.label} />
            <Selector
              label="Store"
              isLabelHidden
              size="sm"
              variant="secondary"
              value={data.storeId}
              options={order.map((id) => ({
                value: id,
                label: stores[id]?.name ?? id,
                description: `${stores[id]?.actions.length ?? 0} actions`,
              }))}
              onChange={(value) => value && model.selectStore(value)}
            />
            <Button
              label={data.paused ? 'Resume' : 'Pause'}
              isIconOnly={compact}
              icon={<Icon icon={data.paused ? Play : Pause} />}
              tooltip={data.paused ? 'Resume recording' : 'Pause recording'}
              onClick={() => model.command({ type: data.paused ? 'resume' : 'pause' })}
            />
          </>
        }
        endContent={
          <>
            {compact ? null : filterInput}
            <Switch
              label="Functions"
              size="sm"
              isLabelHidden={compact}
              labelTooltip="Show the store's actions (functions) in the state tree"
              value={showFunctions}
              onChange={(checked) => model.setShowFunctions(checked)}
            />
            <MoreMenu
              label="Store actions"
              size="sm"
              alignment="end"
              items={[
                {
                  label: 'Commit',
                  description: 'Keep the current state and clear the history',
                  onClick: () => model.command({ type: 'commit' }),
                },
                {
                  label: 'Reset',
                  description: 'Return to the initial state',
                  variant: 'destructive',
                  onClick: () => model.command({ type: 'reset' }),
                },
                { type: 'divider' },
                {
                  label: 'Export session',
                  description: 'Download the history as JSON',
                  onClick: () => model.command({ type: 'export' }),
                },
                {
                  label: 'Import state…',
                  description: 'Load state from an exported file',
                  onClick: () => setImportOpen(true),
                },
              ]}
            />
          </>
        }
      />
      {compact ? (
        <LayoutHeader hasDivider label="Filter">
          {filterInput}
        </LayoutHeader>
      ) : null}
      <Scrubber model={model} data={data} />
      <ImportDialog model={model} storeName={data.name} isOpen={importOpen} onOpenChange={setImportOpen} />
    </VStack>
  )
}

function ImportDialog({
  model,
  storeName,
  isOpen,
  onOpenChange,
}: {
  model: PanelModel
  storeName: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  const close = (open: boolean) => {
    if (!open) {
      setFile(null)
      setError(null)
    }
    onOpenChange(open)
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={close} purpose="form" width={440}>
      <Layout
        header={<DialogHeader title="Import state" subtitle={`Into the "${storeName}" store`} onOpenChange={close} />}
        content={
          <LayoutContent>
            <VStack gap={3}>
              <Text type="supporting">
                Choose a session exported from this panel, or any JSON state. Actions and redacted fields keep their live values.
              </Text>
              <FileInput
                label="State file"
                isLabelHidden
                mode="dropzone"
                accept="application/json,.json"
                value={file}
                status={error ? { type: 'error', message: error } : undefined}
                onChange={async (next) => {
                  const picked = Array.isArray(next) ? (next[0] ?? null) : next
                  setFile(picked)
                  setError(null)
                  if (!picked) return
                  try {
                    const state = stateFromImport(JSON.parse(await picked.text()))
                    if (state === undefined) throw new Error('empty')
                    model.command({ type: 'import', state })
                    close(false)
                  } catch {
                    setError('That file is not valid JSON state. Export a session from this panel and try again.')
                  }
                }}
              />
            </VStack>
          </LayoutContent>
        }
      />
    </Dialog>
  )
}

function Scrubber({ model, data }: { model: PanelModel; data: PanelStoreData }) {
  const index = Math.max(0, data.actions.findIndex((a) => a.id === data.currentId))
  const last = data.actions.at(-1)
  const atLatest = data.currentId === last?.id
  const frame = useRef<number | null>(null)
  const pending = useRef(0)

  const jumpToIndex = (i: number) => {
    pending.current = i
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const action = data.actions[pending.current]
      if (action) {
        model.selectAction(null)
        model.command({ type: 'jump', toId: action.id })
      }
    })
  }

  return (
    <LayoutHeader hasDivider label="Time travel">
      <HStack gap={3} vAlign="center">
        <Text type="supporting" hasTabularNumbers>
          {index + 1} / {data.actions.length}
        </Text>
        <StackItem size="fill">
          <Slider
            label="Time travel"
            isLabelHidden
            valueDisplay="none"
            width="100%"
            min={0}
            max={Math.max(1, data.actions.length - 1)}
            value={index}
            isDisabled={data.actions.length < 2}
            disabledMessage="Record a few actions first"
            onChange={(value: number | [number, number]) => jumpToIndex(Array.isArray(value) ? value[0] : value)}
          />
        </StackItem>
        {!atLatest && last ? (
          <>
            <Token label="Time travelling" color="blue" size="sm" icon={<Icon icon={History} size="xsm" />} />
            <Button
              label="Back to latest"
              size="sm"
              variant="ghost"
              icon={<Icon icon={SkipForward} />}
              onClick={() => {
                model.selectAction(null)
                model.command({ type: 'jump', toId: last.id })
              }}
            />
          </>
        ) : null}
      </HStack>
    </LayoutHeader>
  )
}

function Timeline({
  model,
  data,
  onSelect,
}: {
  model: PanelModel
  data: PanelStoreData
  onSelect: (id: number) => void
}) {
  const filter = useStore(model.store, (s) => s.filter.trim().toLowerCase())
  const selectedAction = useStore(model.store, (s) => s.selectedAction)
  const followRef = useRef<HTMLLIElement>(null)
  const selected = selectedAction ?? data.currentId
  const currentIndex = data.actions.findIndex((a) => a.id === data.currentId)
  const futureFrom = data.actions[currentIndex + 1]?.id ?? Infinity
  const first = data.actions[0]?.ts ?? 0
  const visible = filter ? data.actions.filter((a) => a.name.toLowerCase().includes(filter)) : data.actions

  // Keep the selected row (the live one while following) in view.
  useEffect(() => {
    followRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selected, data.actions.length])

  return (
    <VStack gap={0}>
      {data.dropped > 0 ? (
        <HStack paddingInline={3} paddingBlock={1.5}>
          <Text type="supporting">
            {data.dropped} older action{data.dropped === 1 ? '' : 's'} dropped (keeps the last {data.maxHistory})
          </Text>
        </HStack>
      ) : null}
      <List density="compact" hasDividers>
        {visible.map((action) => {
          const isFuture = action.id >= futureFrom
          return (
            <ListItem
              key={action.id}
              ref={action.id === selected ? followRef : undefined}
              isSelected={action.id === selected}
              onClick={() => onSelect(action.id)}
              startContent={
                <Text type="supporting" hasTabularNumbers>
                  #{action.id}
                </Text>
              }
              label={
                <HStack gap={2} vAlign="center">
                  <StackItem size="fill">
                    <Text type="code" maxLines={1} color={isFuture ? 'secondary' : 'primary'}>
                      {action.name}
                    </Text>
                  </StackItem>
                  {action.source !== 'app' ? <Token label={action.source} size="sm" color="gray" /> : null}
                </HStack>
              }
              endContent={
                <HStack gap={1} vAlign="center">
                  <Text type="supporting" hasTabularNumbers>
                    {action.id === data.actions[0]?.id ? formatTime(action.ts).slice(0, 8) : formatDelta(action.ts - first)}
                  </Text>
                  {action.id === data.currentId ? (
                    <StatusDot variant="success" label="Current state" tooltip="Current state" />
                  ) : (
                    <IconButton
                      label={`Jump to #${action.id}`}
                      tooltip="Jump to this state"
                      size="sm"
                      variant="ghost"
                      icon={<Icon icon={Undo2} />}
                      onClick={(e) => {
                        e.stopPropagation()
                        model.command({ type: 'jump', toId: action.id })
                      }}
                    />
                  )}
                </HStack>
              }
            />
          )
        })}
      </List>
      {visible.length === 0 ? (
        <HStack paddingInline={3} paddingBlock={3}>
          <Text type="supporting">No actions match "{filter}".</Text>
        </HStack>
      ) : null}
    </VStack>
  )
}

function Detail({ model, data, onClose }: { model: PanelModel; data: PanelStoreData; onClose?: () => void }) {
  const selectedAction = useStore(model.store, (s) => s.selectedAction)
  const tab = useStore(model.store, (s) => s.tab)
  const id = selectedAction ?? data.currentId
  const action = data.actions.find((a) => a.id === id)
  const inDrawer = onClose !== undefined
  const panelId = `zi-detail-${inDrawer ? 'drawer' : 'pane'}`

  if (!action) {
    return (
      <VStack height="100%" justify="center" align="center">
        <EmptyState isCompact title="Select an action" description="Its state, diff and details show here." />
      </VStack>
    )
  }
  const isCurrent = action.id === data.currentId
  const changeCount = action.changes?.length ?? 0

  const title = (
    <Text type="code" weight="semibold" maxLines={1}>
      #{action.id} {action.name}
    </Text>
  )
  const time = (
    <Text type="supporting" hasTabularNumbers>
      {formatTime(action.ts)}
    </Text>
  )
  const current = isCurrent ? <StatusDot variant="success" label="Current state" tooltip="Current state" /> : null
  const jump = !isCurrent ? (
    <Button
      label="Jump here"
      variant="primary"
      size="sm"
      icon={<Icon icon={Undo2} />}
      onClick={() => model.command({ type: 'jump', toId: action.id })}
    />
  ) : null
  const tabs = (
    <TabList value={tab} onChange={(value) => model.setTab(value as PanelTab)} role="tablist" size="sm">
      <Tab value="state" label="State" panelId={panelId} />
      <Tab
        value="diff"
        label="Diff"
        panelId={panelId}
        endContent={changeCount > 0 ? <Badge label={String(changeCount)} /> : undefined}
      />
      <Tab value="action" label="Action" panelId={panelId} />
    </TabList>
  )

  // In the pane: one toolbar row. In the narrow Drawer: the documented
  // DrawerHeader (title, time, close) above a toolbar row for tabs and Jump.
  const header = inDrawer ? (
    <VStack gap={0}>
      <DrawerHeader
        title={title}
        subtitle={time}
        endContent={current}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      />
      <Toolbar label="Detail view" size="sm" gap={2} dividers={['bottom']} startContent={tabs} endContent={jump} />
    </VStack>
  ) : (
    <Toolbar
      label={`Action #${action.id}`}
      size="sm"
      gap={2}
      dividers={['bottom']}
      startContent={
        <>
          {title}
          {time}
          {current}
        </>
      }
      endContent={
        <>
          {jump}
          {tabs}
        </>
      }
    />
  )

  return (
    <Layout
      header={header}
      content={
        <LayoutContent padding={3} label={`${tab} of action #${action.id}`} role="tabpanel" id={panelId}>
          {tab === 'state' ? (
            <StateView model={model} data={data} action={action} />
          ) : tab === 'diff' ? (
            <DiffView model={model} action={action} />
          ) : (
            <ActionView action={action} />
          )}
        </LayoutContent>
      }
    />
  )
}

function StateView({ model, data, action }: { model: PanelModel; data: PanelStoreData; action: ActionMeta }) {
  const isCurrent = action.id === data.currentId
  const snapshot = useStore(model.store, (s) => s.snapshots[snapshotKey(data.storeId, action.id)])
  const showFunctions = useStore(model.store, (s) => s.showFunctions)
  const known = isCurrent || snapshot !== undefined
  const value = isCurrent ? data.state : snapshot

  useEffect(() => {
    if (!known) model.snapshot(data.storeId, action.id)
  }, [known, model, data.storeId, action.id])

  const items = useMemo(
    () => (known ? toTreeItems(value, data.storeId, showFunctions, 0) : []),
    [known, value, data.storeId, showFunctions],
  )

  if (!known) return <Text color="secondary">Loading snapshot…</Text>
  if (kindOf(value) === 'leaf') return <ValueText value={value} />
  if (items.length === 0) return <ValueText described={summarize(value, showFunctions)} />
  // Keyed by store so expansion state does not carry over between stores.
  return <TreeList key={data.storeId} density="compact" items={items} />
}

function toTreeItems(value: unknown, path: string, showFunctions: boolean, depth: number): Array<TreeListItemData> {
  return childrenOf(value, showFunctions).map((child) => {
    const id = `${path}/${child.segment}`
    const children = kindOf(child.value) === 'leaf' ? [] : toTreeItems(child.value, id, showFunctions, depth + 1)
    const shown = children.length > 0 ? summarize(child.value, showFunctions) : describe(child.value)
    const label = <KeyValue name={child.key} value={shown} />
    return children.length > 0 ? { id, label, children, isExpanded: depth === 0 } : { id, label }
  })
}

function DiffView({ model, action }: { model: PanelModel; action: ActionMeta }) {
  const showFunctions = useStore(model.store, (s) => s.showFunctions)
  if (action.source === 'init') return <Text color="secondary">Initial state. Nothing to compare with.</Text>
  if (!action.changes) return <Text color="secondary">Diffs are turned off for this store.</Text>
  const changes = action.changes.filter((c) => showFunctions || !isFunctionChange(c))
  if (changes.length === 0) {
    return <Text color="secondary">No changes. This action set the values it already had.</Text>
  }
  return (
    <VStack gap={2}>
      <List density="compact" hasDividers edge="flush">
        {changes.map((change, i) => (
          <ListItem
            key={`${formatPath(change.path)}-${i}`}
            align="first-line"
            startContent={<Badge variant={badgeFor(change.kind)} label={change.kind} />}
            label={
              <Text type="code" weight="semibold" maxLines={1}>
                {formatPath(change.path)}
              </Text>
            }
            description={<ChangeValues change={change} />}
          />
        ))}
      </List>
      {action.changesTruncated ? <Text type="supporting">Showing the first 200 changes.</Text> : null}
    </VStack>
  )
}

function ChangeValues({ change }: { change: Change }) {
  if (change.kind === 'added') return <ValueText value={change.to} />
  if (change.kind === 'removed') return <ValueText value={change.from} isStruck />
  return (
    <HStack gap={1.5} vAlign="center" wrap="wrap">
      <ValueText value={change.from} isStruck />
      <Text type="code" color="secondary">
        →
      </Text>
      <ValueText value={change.to} />
    </HStack>
  )
}

function badgeFor(kind: Change['kind']): 'success' | 'error' | 'warning' {
  return kind === 'added' ? 'success' : kind === 'removed' ? 'error' : 'warning'
}

function isFunctionChange(change: Change): boolean {
  const isFn = (v: unknown) => typeof v === 'object' && v !== null && (v as { $t?: string }).$t === 'function'
  return (change.from === undefined || isFn(change.from)) && (change.to === undefined || isFn(change.to))
}

function ActionView({ action }: { action: ActionMeta }) {
  const source = { app: 'App', init: 'Initial state', devtools: 'Devtools' }[action.source]
  return (
    <MetadataList label={{ width: 96 }}>
      <MetadataListItem label="Name">
        <Text type="code">{action.name}</Text>
      </MetadataListItem>
      <MetadataListItem label="Id">
        <Text type="code" hasTabularNumbers>
          #{action.id}
        </Text>
      </MetadataListItem>
      <MetadataListItem label="Source">
        <Token label={source} size="sm" color={action.source === 'app' ? 'default' : 'gray'} />
      </MetadataListItem>
      <MetadataListItem label="Time">
        <Text type="code" hasTabularNumbers>
          {new Date(action.ts).toISOString()}
        </Text>
      </MetadataListItem>
      <MetadataListItem label="Changes">
        <Text hasTabularNumbers>{action.changes ? String(action.changes.length) : 'Not recorded'}</Text>
      </MetadataListItem>
      {action.payload !== undefined ? (
        <MetadataListItem label="Payload">
          {kindOf(action.payload) === 'leaf' ? (
            <ValueText value={action.payload} />
          ) : (
            <TreeList density="compact" items={toTreeItems(action.payload, `payload-${action.id}`, true, 0)} />
          )}
        </MetadataListItem>
      ) : null}
    </MetadataList>
  )
}

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
import { Tooltip } from '@astryxdesign/core/Tooltip'
import { Section } from '@astryxdesign/core/Section'
import { Banner } from '@astryxdesign/core/Banner'
import { ToggleButton, ToggleButtonGroup } from '@astryxdesign/core/ToggleButton'
import { ChevronDown, ChevronRight, CircleDot, SkipBack, StepBack, StepForward, Database, Flag, GitBranch, GitCompareArrows, Pause, Pin, PinOff, Play, SkipForward, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { formatPath } from '../diff'
import { downloadJson, stateFromImport } from '../files'
import {
  actionsTouching,
  changesAt,
  flagsFor,
  formatMs,
  formatSize,
  historyMayBeIncomplete,
  lastChangeOf,
  rangeDiff,
  samePath,
  valueAt,
  asyncError,
  defaultAsyncConvention,
  groupAsyncActions,
  type AsyncConvention,
  type AsyncGroup,
  type AsyncGrouping,
  type CostFlag,
  type FlagKind,
  type Path,
} from '../analysis'
import { snapshotKey, type CostFilter, type PanelModel, type PanelStoreData, type PanelTab } from '../model'
import { formatDelta, formatTime } from '../panel/format'
import type { ActionMeta, Change } from '../protocol'
import { childrenOf, describe, isFunctionValue, KeyValue, kindOf, summarize, ValueText } from './Value'

/*
 * Responsive contract (width of the devtools pane, measured by mount.tsx):
 *   >= 720  two regions: resizable action list (start panel) | action detail (content)
 *   <  720  one region: the action list; selecting an action opens the detail in a Drawer
 *   <  560  the filter leaves the toolbar for its own header row, Pause becomes icon-only
 */
const TWO_REGIONS_MIN = 720
const COMPACT_MAX = 560

export function InspectorPanel({
  model,
  width,
  asyncConvention,
}: {
  model: PanelModel
  width: number
  /** How async calls are read from action names; `false` turns grouping off. */
  asyncConvention?: AsyncConvention | false
}) {
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
  const actions = data?.actions
  const grouping = useMemo(
    () =>
      actions && asyncConvention !== false
        ? groupAsyncActions(actions, asyncConvention ?? defaultAsyncConvention)
        : NO_GROUPS,
    [actions, asyncConvention],
  )
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

  const onSelect = (id: number, range: boolean) => {
    const picking = model.store.getState().comparePick
    if (picking) {
      model.pickCompare(id)
      // Open the detail only once both ends of the comparison are chosen.
      if (!twoRegions && model.store.getState().comparePick === null) setDrawerOpen(true)
      return
    }
    if (range) model.selectRange(id)
    else model.selectAction(id)
    if (!twoRegions) setDrawerOpen(true)
  }
  const onSelectGroup = (group: AsyncGroup) => {
    // The whole call: from the state before it started to its last action.
    const index = data.actions.findIndex((a) => a.id === group.start.id)
    const before = data.actions[index - 1]?.id ?? group.start.id
    model.selectGroup(group.id, before, (group.end ?? group.start).id)
    if (!twoRegions) setDrawerOpen(true)
  }
  const timeline = (
    <Timeline model={model} data={data} grouping={grouping} onSelect={onSelect} onSelectGroup={onSelectGroup} />
  )

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
              <Detail model={model} data={data} grouping={grouping} />
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
          <Detail model={model} data={data} grouping={grouping} onClose={() => setDrawerOpen(false)} />
        </Drawer>
      ) : null}
    </>
  )
}

/** `" 3 / 12"`: the index is padded with figure spaces so the label keeps its width. */
function position(index: number, total: number): string {
  const width = String(total).length
  return `${String(index + 1).padStart(width, '\u2007')} / ${total}`
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
  const currentSize = data.actions.find((a) => a.id === data.currentId)?.cost?.stateSize

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
            {currentSize !== undefined && !compact ? (
              <Tooltip content="Size of the current state, serialized">
                <Text type="supporting" hasTabularNumbers>
                  {formatSize(currentSize)}
                </Text>
              </Tooltip>
            ) : null}
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
      <Scrubber model={model} data={data} compact={compact} />
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

function Scrubber({ model, data, compact }: { model: PanelModel; data: PanelStoreData; compact: boolean }) {
  const index = Math.max(0, data.actions.findIndex((a) => a.id === data.currentId))
  const last = data.actions.at(-1)
  const atLatest = data.currentId === last?.id
  const atStart = index === 0
  const frame = useRef<number | null>(null)
  const pending = useRef(0)
  const actionsRef = useRef(data.actions)
  actionsRef.current = data.actions
  // While dragging, the slider shows the position it reported, not the store's
  // current position: that one lags a frame behind, and feeding it back makes
  // the thumb run ahead of the pointer.
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  useEffect(() => {
    if (dragIndex !== null && dragIndex === index) setDragIndex(null)
  }, [dragIndex, index])

  const jumpToIndex = (i: number) => {
    pending.current = i
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const action = actionsRef.current[pending.current]
      if (action) {
        model.selectAction(null)
        model.command({ type: 'jump', toId: action.id })
      }
    })
  }
  const toIndex = (value: number | [number, number]) => (Array.isArray(value) ? value[0] : value)
  // Steps build on a jump still waiting for its frame, so quick clicks add up.
  const step = (delta: number) => {
    const from = frame.current !== null ? pending.current : index
    const to = Math.min(Math.max(from + delta, 0), data.actions.length - 1)
    setDragIndex(null)
    if (to !== from) jumpToIndex(to)
  }
  const toEdge = (i: number) => {
    setDragIndex(null)
    jumpToIndex(i)
  }
  const empty = data.actions.length < 2

  return (
    <LayoutHeader hasDivider label="Time travel">
      <HStack gap={compact ? 1 : 2} vAlign="center">
        <Text type="supporting" hasTabularNumbers>
          {position(dragIndex ?? index, data.actions.length)}
        </Text>
        <IconButton
          label="Back to start"
          tooltip={atStart ? 'Already at the first recorded state' : 'Jump to the first recorded state'}
          size="sm"
          variant="ghost"
          icon={<Icon icon={SkipBack} />}
          isDisabled={atStart || empty}
          onClick={() => toEdge(0)}
        />
        <IconButton
          label="Previous state"
          tooltip="Step back one action"
          size="sm"
          variant="ghost"
          icon={<Icon icon={StepBack} />}
          isDisabled={atStart || empty}
          onClick={() => step(-1)}
        />
        <StackItem size="fill">
          <Slider
            label="Time travel"
            isLabelHidden
            valueDisplay="none"
            width="100%"
            min={0}
            max={Math.max(1, data.actions.length - 1)}
            value={dragIndex ?? index}
            isDisabled={data.actions.length < 2}
            disabledMessage="Record a few actions first"
            onChange={(value: number | [number, number]) => {
              setDragIndex(toIndex(value))
              jumpToIndex(toIndex(value))
            }}
            onChangeEnd={(value: number | [number, number]) => jumpToIndex(toIndex(value))}
          />
        </StackItem>
        {/* Always rendered (disabled at the ends), so the slider never changes
            width under the pointer when a drag leaves the latest state. */}
        <IconButton
          label="Next state"
          tooltip="Step forward one action"
          size="sm"
          variant="ghost"
          icon={<Icon icon={StepForward} />}
          isDisabled={atLatest || empty}
          onClick={() => step(1)}
        />
        {compact ? (
          <IconButton
            label="Back to latest"
            tooltip={atLatest ? 'Already at the latest state' : 'Return to the latest state'}
            size="sm"
            variant="ghost"
            icon={<Icon icon={SkipForward} />}
            isDisabled={atLatest || !last}
            onClick={() => toEdge(data.actions.length - 1)}
          />
        ) : (
          <Button
            label="Back to latest"
            size="sm"
            variant="ghost"
            icon={<Icon icon={SkipForward} />}
            isDisabled={atLatest || !last}
            tooltip={atLatest ? 'Already at the latest state' : 'Return to the latest state'}
            onClick={() => toEdge(data.actions.length - 1)}
          />
        )}
      </HStack>
    </LayoutHeader>
  )
}

function costCounts(actions: ReadonlyArray<ActionMeta>) {
  let slow = 0
  let wasted = 0
  for (const action of actions) {
    const kinds = flagsFor(action).map((f) => f.kind)
    if (kinds.includes('slow')) slow++
    if (kinds.includes('noop') || kinds.includes('sameValue')) wasted++
  }
  return { slow, wasted }
}

function matchesCost(action: ActionMeta, filter: CostFilter): boolean {
  if (filter === 'all') return true
  const kinds = flagsFor(action).map((f) => f.kind)
  return filter === 'slow' ? kinds.includes('slow') : kinds.includes('noop') || kinds.includes('sameValue')
}

const FLAG_COLOR: Record<FlagKind, 'red' | 'yellow' | 'gray'> = {
  slow: 'red',
  noop: 'yellow',
  sameValue: 'yellow',
  large: 'gray',
}

function FlagToken({ flag }: { flag: CostFlag }) {
  return (
    <Tooltip content={flag.detail}>
      <Token label={flag.label} size="sm" color={FLAG_COLOR[flag.kind]} description={flag.detail} />
    </Tooltip>
  )
}

function Timeline({
  model,
  data,
  grouping,
  onSelect,
  onSelectGroup,
}: {
  model: PanelModel
  data: PanelStoreData
  grouping: AsyncGrouping
  onSelect: (id: number, range: boolean) => void
  onSelectGroup: (group: AsyncGroup) => void
}) {
  const filter = useStore(model.store, (s) => s.filter.trim().toLowerCase())
  const selectedAction = useStore(model.store, (s) => s.selectedAction)
  const compareFrom = useStore(model.store, (s) => s.compareFrom)
  const costFilter = useStore(model.store, (s) => s.costFilter)
  const pinnedPath = useStore(model.store, (s) => s.pinnedPath)
  const comparePick = useStore(model.store, (s) => s.comparePick)
  const selectedGroup = useStore(model.store, (s) => s.selectedGroup)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const toggleGroup = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const followRef = useRef<HTMLLIElement>(null)
  const selected = selectedAction ?? data.currentId
  const shiftHeld = useShiftHeld()
  // Holding Shift previews the start of a shift-click comparison: the selected
  // action is tagged From until Shift is released.
  // A selected async call is its own kind of range: no From/To tags.
  const ends = selectedGroup
    ? null
    : (compareEnds(data, compareFrom, comparePick === 'to' ? null : selected) ??
      (shiftHeld && comparePick === null ? { from: selected } : null))
  const currentIndex = data.actions.findIndex((a) => a.id === data.currentId)
  const futureFrom = data.actions[currentIndex + 1]?.id ?? Infinity
  const first = data.actions[0]?.ts ?? 0
  const counts = useMemo(() => costCounts(data.actions), [data.actions])
  const touching = useMemo(
    () => (pinnedPath ? new Set(actionsTouching(data.actions, pinnedPath).map((a) => a.id)) : null),
    [data.actions, pinnedPath],
  )
  const isVisible = (a: ActionMeta) =>
    (!filter || a.name.toLowerCase().includes(filter)) &&
    matchesCost(a, costFilter) &&
    (!touching || touching.has(a.id) || a.source === 'init')
  // Async calls show as one row at their start; their actions show under it when expanded.
  const rows: Array<{ group: AsyncGroup } | { action: ActionMeta; member?: AsyncGroup }> = []
  for (const action of data.actions) {
    const group = grouping.groupOf.get(action.id)
    if (!group) {
      if (isVisible(action)) rows.push({ action })
      continue
    }
    if (action.id !== group.start.id) continue
    const members = group.end ? [group.start, group.end] : [group.start]
    if (!members.some(isVisible)) continue
    rows.push({ group })
    const open = expanded.has(group.id) || (selectedAction !== null && members.some((m) => m.id === selectedAction))
    if (open) for (const member of members) rows.push({ action: member, member: group })
  }

  // Keep the selected row (the live one while following) in view.
  useEffect(() => {
    followRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selected, data.actions.length])

  return (
    <VStack gap={0}>
      <HStack gap={2} paddingInline={3} paddingBlock={1.5} vAlign="center" wrap="wrap">
        <ToggleButtonGroup
          label="Show actions"
          size="sm"
          type="single"
          value={costFilter}
          onChange={(value) => model.setCostFilter((typeof value === 'string' ? value : 'all') as CostFilter)}
        >
          <ToggleButton value="all" label={`All ${data.actions.length}`} />
          <ToggleButton
            value="slow"
            label={`Slow ${counts.slow}`}
            tooltip="set() took longer than a frame, listeners included"
          />
          <ToggleButton
            value="wasted"
            label={`Wasted ${counts.wasted}`}
            tooltip="No value changed, or a new reference held an equal value"
          />
        </ToggleButtonGroup>
        <ToggleButton
          label="Compare"
          size="sm"
          icon={<Icon icon={GitCompareArrows} />}
          tooltip="Pick an initial and a final state to diff"
          isPressed={comparePick !== null}
          onPressedChange={(pressed) => (pressed ? model.startCompare() : model.clearCompare())}
        >
          Compare
        </ToggleButton>
        {pinnedPath ? (
          <Token
            label={`Pinned ${formatPath(pinnedPath)}`}
            size="sm"
            color="blue"
            icon={<Icon icon={Pin} size="xsm" />}
            description={`Showing the ${touching?.size ?? 0} actions that changed ${formatPath(pinnedPath)}`}
            onRemove={() => model.pinPath(null)}
          />
        ) : null}
      </HStack>
      {comparePick ? (
        <HStack paddingInline={3} paddingBlockEnd={2}>
          <StackItem size="fill">
            <Banner
              status="info"
              icon={<Icon icon={GitCompareArrows} />}
              title={comparePick === 'from' ? 'Step 1 of 2: pick the initial state' : 'Step 2 of 2: pick the final state'}
              description={
                comparePick === 'from'
                  ? 'Click the action whose state the comparison starts from.'
                  : `From #${compareFrom} ${data.actions.find((a) => a.id === compareFrom)?.name ?? ''}. Click a second action to compare with it.`
              }
              endContent={<Button label="Cancel" size="sm" variant="ghost" onClick={() => model.clearCompare()} />}
            />
          </StackItem>
        </HStack>
      ) : null}
      {data.dropped > 0 ? (
        <HStack paddingInline={3} paddingBlock={1.5}>
          <Text type="supporting">
            {data.dropped} older action{data.dropped === 1 ? '' : 's'} dropped (keeps the last {data.maxHistory})
          </Text>
        </HStack>
      ) : null}
      <List density="compact" hasDividers>
        {rows.map((row) => {
          if ('group' in row) {
            const { group } = row
            const members = group.end ? [group.start, group.end] : [group.start]
            const open = expanded.has(group.id) || (selectedAction !== null && members.some((m) => m.id === selectedAction))
            const isSelected = selectedGroup === group.id
            const target = (group.end ?? group.start).id
            const holdsCurrent = members.some((m) => m.id === data.currentId)
            return (
              <ListItem
                key={group.id}
                isSelected={isSelected}
                data-zi-row={isSelected ? 'selected' : undefined}
                onClick={() => onSelectGroup(group)}
                startContent={
                  <IconButton
                    label={open ? `Hide the actions of ${group.key}` : `Show the actions of ${group.key}`}
                    size="sm"
                    variant="ghost"
                    icon={<Icon icon={open ? ChevronDown : ChevronRight} />}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleGroup(group.id)
                    }}
                  />
                }
                label={
                  <HStack gap={2} vAlign="center">
                    <StackItem size="fill">
                      <Text type="code" maxLines={1} color={group.start.id >= futureFrom ? 'secondary' : 'primary'}>
                        {group.key}
                      </Text>
                    </StackItem>
                    <AsyncStatusToken group={group} />
                    {group.ambiguous ? (
                      <Token
                        label="ambiguous"
                        size="sm"
                        color="orange"
                        description={AMBIGUOUS_TEXT}
                      />
                    ) : null}
                  </HStack>
                }
                endContent={
                  <HStack gap={1} vAlign="center">
                    <Text type="supporting" hasTabularNumbers>
                      {group.durationMs === undefined ? 'running' : formatMs(group.durationMs)}
                    </Text>
                    {holdsCurrent && !open ? (
                      <StatusDot variant="success" label="Current state" tooltip="Current state" />
                    ) : target === data.currentId ? (
                      <StatusDot variant="success" label="Current state" tooltip="Current state" />
                    ) : (
                      <IconButton
                        label={`Jump to the end of ${group.key}`}
                        tooltip="Jump to the state after this call"
                        size="sm"
                        variant="ghost"
                        icon={<Icon icon={Undo2} />}
                        onClick={(e) => {
                          e.stopPropagation()
                          model.command({ type: 'jump', toId: target })
                        }}
                      />
                    )}
                  </HStack>
                }
              />
            )
          }
          const { action, member } = row
          const isFuture = action.id >= futureFrom
          const flags = flagsFor(action)
          const end = ends ? (action.id === ends.from ? 'from' : action.id === ends.to ? 'to' : null) : null
          const between = ends?.to !== undefined && isBetween(data, action.id, ends.from, ends.to)
          const comparing = comparePick !== null || ends !== null || selectedGroup !== null
          const isMarked = end !== null || (!comparing && action.id === selected)
          const inSelectedGroup = member !== undefined && member.id === selectedGroup
          return (
            <ListItem
              key={action.id}
              ref={action.id === selected ? followRef : undefined}
              isSelected={isMarked}
              data-zi-row={isMarked ? 'selected' : between || inSelectedGroup ? 'between' : undefined}
              data-zi-member={member ? '' : undefined}
              onClick={(e) => onSelect(action.id, e.shiftKey)}
              startContent={
                <Text type="supporting" hasTabularNumbers color={end || between ? 'accent' : undefined}>
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
                  {end ? (
                    <Token
                      label={end === 'from' ? 'From' : 'To'}
                      size="sm"
                      color="blue"
                      icon={<Icon icon={end === 'from' ? CircleDot : Flag} size="xsm" />}
                      description={end === 'from' ? 'Initial state of the comparison' : 'Final state of the comparison'}
                    />
                  ) : null}
                  {action.source !== 'app' ? <Token label={action.source} size="sm" color="gray" /> : null}
                  {action.branch ? (
                    <Tooltip content={branchText(action.branch)}>
                      <Token
                        label={`from #${action.branch.fromId}`}
                        size="sm"
                        color="orange"
                        icon={<Icon icon={GitBranch} size="xsm" />}
                        description={branchText(action.branch)}
                      />
                    </Tooltip>
                  ) : null}
                  {flags[0] ? <FlagToken flag={flags[0]} /> : null}
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
      {rows.length === 0 ? (
        <HStack paddingInline={3} paddingBlock={3}>
          <Text type="supporting">{emptyTimelineText(filter, costFilter, pinnedPath)}</Text>
        </HStack>
      ) : null}
      <HStack paddingInline={3} paddingBlock={2}>
        <Text type="supporting">To diff two states, use Compare or shift-click a second action.</Text>
      </HStack>
    </VStack>
  )
}

const NO_GROUPS: AsyncGrouping = { groups: [], groupOf: new Map() }

const AMBIGUOUS_TEXT =
  'Another call with the same name was running and neither had a requestId, so this end was paired with the oldest call. Add a requestId to the payload to pair them exactly.'

const STATUS_TOKEN = {
  running: { label: 'running', color: 'blue' },
  fulfilled: { label: 'fulfilled', color: 'green' },
  rejected: { label: 'rejected', color: 'red' },
} as const

function AsyncStatusToken({ group }: { group: AsyncGroup }) {
  const { label, color } = STATUS_TOKEN[group.status]
  return <Token label={label} size="sm" color={color} />
}

function isEditable(target: EventTarget | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
}

/** Whether Shift is held down while the page has focus. */
function useShiftHeld(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return
      // Shift while typing (capital letters) isn't a compare gesture.
      if (e.type === 'keydown' && isEditable(e.composedPath()[0])) return
      setHeld(e.type === 'keydown')
    }
    const release = () => setHeld(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', release)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', release)
    }
  }, [])
  return held
}

/**
 * The ends of a comparison in timeline order: `from` is the earlier state,
 * `to` the later one (undefined while the final state is still being picked).
 */
function compareEnds(
  data: PanelStoreData,
  compareFrom: number | null,
  other: number | null,
): { from: number; to?: number } | null {
  if (compareFrom === null) return null
  if (other === null || other === compareFrom) return { from: compareFrom }
  const range = rangeEnds(data, compareFrom, other)
  return range ? { from: range[0].id, to: range[1].id } : { from: compareFrom }
}

function isBetween(data: PanelStoreData, id: number, from: number, to: number): boolean {
  const i = data.actions.findIndex((a) => a.id === id)
  const a = data.actions.findIndex((x) => x.id === from)
  const b = data.actions.findIndex((x) => x.id === to)
  return i > a && i < b
}

function emptyTimelineText(filter: string, costFilter: CostFilter, pinnedPath: Path | null): string {
  if (filter) return `No actions match "${filter}".`
  if (costFilter === 'slow') return 'No slow actions. Every set() finished within a frame.'
  if (costFilter === 'wasted') return 'No wasted updates recorded.'
  if (pinnedPath) return `No recorded action changed ${formatPath(pinnedPath)}.`
  return 'No actions yet.'
}

/** The two ends of a range, in timeline order. */
function rangeEnds(data: PanelStoreData, a: number, b: number): [ActionMeta, ActionMeta] | null {
  const ia = data.actions.findIndex((x) => x.id === a)
  const ib = data.actions.findIndex((x) => x.id === b)
  if (ia === -1 || ib === -1) return null
  return ia < ib ? [data.actions[ia], data.actions[ib]] : [data.actions[ib], data.actions[ia]]
}

function Detail({
  model,
  data,
  grouping,
  onClose,
}: {
  model: PanelModel
  data: PanelStoreData
  grouping: AsyncGrouping
  onClose?: () => void
}) {
  const selectedAction = useStore(model.store, (s) => s.selectedAction)
  const selectedGroup = useStore(model.store, (s) => s.selectedGroup)
  const group = selectedGroup ? grouping.groups.find((g) => g.id === selectedGroup) : undefined
  const compareFrom = useStore(model.store, (s) => s.compareFrom)
  const comparePick = useStore(model.store, (s) => s.comparePick)
  const tab = useStore(model.store, (s) => s.tab)
  // While the final state is being picked, show the chosen initial state, not a preview range.
  const picking = comparePick === 'to' && compareFrom !== null
  const id = picking ? compareFrom : (selectedAction ?? data.currentId)
  const action = data.actions.find((a) => a.id === id)
  const inDrawer = onClose !== undefined
  const panelId = `zi-detail-${inDrawer ? 'drawer' : 'pane'}`
  const range = compareFrom !== null && !picking ? rangeEnds(data, compareFrom, id) : null
  const rangeChanges = useRangeDiff(model, data, range)

  if (!action) {
    return (
      <VStack height="100%" justify="center" align="center">
        <EmptyState isCompact title="Select an action" description="Its state, diff and details show here." />
      </VStack>
    )
  }
  const isCurrent = action.id === data.currentId
  const changeCount = range ? (rangeChanges?.changes.length ?? 0) : (action.changes?.length ?? 0)

  const title = group ? (
    <HStack gap={1.5} vAlign="center">
      <Text type="code" weight="semibold" maxLines={1}>
        {group.key}
      </Text>
      <AsyncStatusToken group={group} />
    </HStack>
  ) : range ? (
    <HStack gap={1.5} vAlign="center">
      <Token
        label={`From #${range[0].id} ${range[0].name}`}
        size="sm"
        color="blue"
        icon={<Icon icon={CircleDot} size="xsm" />}
        description="Initial state of the comparison"
      />
      <Text type="code" color="secondary">
        →
      </Text>
      <Token
        label={`To #${range[1].id} ${range[1].name}`}
        size="sm"
        color="blue"
        icon={<Icon icon={Flag} size="xsm" />}
        description="Final state of the comparison"
      />
    </HStack>
  ) : picking ? (
    <HStack gap={1.5} vAlign="center">
      <Token
        label={`From #${action.id} ${action.name}`}
        size="sm"
        color="blue"
        icon={<Icon icon={CircleDot} size="xsm" />}
        description="Initial state of the comparison"
      />
      <Text type="supporting">→ pick the final state</Text>
    </HStack>
  ) : (
    <Text type="code" weight="semibold" maxLines={1}>
      #{action.id} {action.name}
    </Text>
  )
  const subtitle = group ? (
    <Text type="supporting" hasTabularNumbers>
      {group.durationMs === undefined ? 'running' : formatMs(group.durationMs)} · #{group.start.id}
      {group.end ? `–#${group.end.id}` : ''}
    </Text>
  ) : range || picking ? (
    <Button label="Stop comparing" size="sm" variant="ghost" onClick={() => model.clearCompare()} />
  ) : (
    <Text type="supporting" hasTabularNumbers>
      {formatTime(action.ts)}
    </Text>
  )
  const current = isCurrent && !range && !picking ? <StatusDot variant="success" label="Current state" tooltip="Current state" /> : null
  const jump =
    !isCurrent && !range && !picking ? (
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
        subtitle={subtitle}
        endContent={current}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      />
      <Toolbar label="Detail view" size="sm" gap={2} dividers={['bottom']} startContent={tabs} endContent={jump} />
    </VStack>
  ) : (
    <Toolbar
      label={group ? `Async call ${group.key}` : range ? 'Range comparison' : `Action #${action.id}`}
      size="sm"
      gap={2}
      dividers={['bottom']}
      startContent={
        <>
          {title}
          {subtitle}
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
            <DiffView
              model={model}
              action={action}
              range={range}
              rangeChanges={rangeChanges}
              summary={group ? `during ${group.key} (#${group.start.id}–#${action.id})` : undefined}
            />
          ) : group ? (
            <AsyncCallView group={group} />
          ) : (
            <ActionView action={action} />
          )}
        </LayoutContent>
      }
    />
  )
}

/** Snapshots of both ends of a range, diffed once both have arrived from the page. */
function useRangeDiff(model: PanelModel, data: PanelStoreData, range: [ActionMeta, ActionMeta] | null) {
  const fromKey = range ? snapshotKey(data.storeId, range[0].id) : ''
  const toKey = range ? snapshotKey(data.storeId, range[1].id) : ''
  const from = useStore(model.store, (s) => (range ? s.snapshots[fromKey] : undefined))
  const to = useStore(model.store, (s) => (range ? s.snapshots[toKey] : undefined))
  useEffect(() => {
    if (!range) return
    model.snapshot(data.storeId, range[0].id)
    model.snapshot(data.storeId, range[1].id)
  }, [model, data.storeId, range?.[0].id, range?.[1].id])
  return useMemo(
    () => (range && from !== undefined && to !== undefined ? rangeDiff(from, to) : null),
    [range?.[0].id, range?.[1].id, from, to],
  )
}

function StateView({ model, data, action }: { model: PanelModel; data: PanelStoreData; action: ActionMeta }) {
  const isCurrent = action.id === data.currentId
  const snapshot = useStore(model.store, (s) => s.snapshots[snapshotKey(data.storeId, action.id)])
  const showFunctions = useStore(model.store, (s) => s.showFunctions)
  const search = useStore(model.store, (s) => s.stateSearch)
  const selectedPath = useStore(model.store, (s) => s.selectedPath)
  const pinnedPath = useStore(model.store, (s) => s.pinnedPath)
  const known = isCurrent || snapshot !== undefined
  const value = isCurrent ? data.state : snapshot

  useEffect(() => {
    if (!known) model.snapshot(data.storeId, action.id)
  }, [known, model, data.storeId, action.id])

  const root = pinnedPath && known ? valueAt(value, pinnedPath) : { found: true, value }
  const query = search.trim().toLowerCase()
  const items = useMemo(
    () =>
      known && root.found
        ? toTreeItems(root.value, pinnedPath ?? [], showFunctions, 0, {
            query,
            selectedPath,
            onSelect: (path) => model.selectPath(samePath(path, selectedPath) ? null : path),
          })
        : [],
    [known, root.found, root.value, pinnedPath, showFunctions, query, selectedPath, model],
  )

  return (
    <VStack gap={3}>
      <TextInput
        label="Search state"
        isLabelHidden
        size="sm"
        startIcon="search"
        placeholder="Search keys and values"
        hasClear
        value={search}
        onChange={(next) => model.setStateSearch(next)}
      />
      {selectedPath ? <PathHistory model={model} data={data} action={action} path={selectedPath} value={value} /> : null}
      {!known ? (
        <Text color="secondary">Loading snapshot…</Text>
      ) : !root.found ? (
        <Text color="secondary">{formatPath(pinnedPath ?? [])} does not exist in this state.</Text>
      ) : kindOf(root.value) === 'leaf' ? (
        <ValueText value={root.value} />
      ) : items.length === 0 ? (
        query ? (
          <Text color="secondary">Nothing in this state matches "{search.trim()}".</Text>
        ) : (
          <ValueText described={summarize(root.value, showFunctions)} />
        )
      ) : (
        // Re-keyed when the search, pin or store changes, so matches open fresh.
        <TreeList key={`${data.storeId}|${query}|${formatPath(pinnedPath ?? [])}`} density="compact" items={items} />
      )}
    </VStack>
  )
}

interface TreeOptions {
  query: string
  selectedPath: Path | null
  onSelect: (path: Path) => void
}

function toTreeItems(
  value: unknown,
  path: Path,
  showFunctions: boolean,
  depth: number,
  options?: TreeOptions,
): Array<TreeListItemData> {
  const items: Array<TreeListItemData> = []
  for (const child of childrenOf(value, showFunctions)) {
    const childPath = [...path, child.segment]
    const id = formatPath(childPath) || child.segment
    const isContainer = kindOf(child.value) !== 'leaf'
    const children = isContainer ? toTreeItems(child.value, childPath, showFunctions, depth + 1, options) : []
    const shown = children.length > 0 ? summarize(child.value, showFunctions) : describe(child.value)
    const query = options?.query ?? ''
    const selfMatches =
      !query || child.key.text.toLowerCase().includes(query) || (!isContainer && shown.text.toLowerCase().includes(query))
    // While searching, keep matches and the branches that lead to them.
    if (query && !selfMatches && children.length === 0) continue
    const item: TreeListItemData = {
      id,
      label: <KeyValue name={child.key} value={shown} />,
    }
    if (options) {
      item.onClick = () => options.onSelect(childPath)
      item.isSelected = samePath(childPath, options.selectedPath)
    }
    if (children.length > 0) {
      item.children = children
      item.isExpanded = query ? true : depth === 0
    }
    items.push(item)
  }
  return items
}

function PathHistory({
  model,
  data,
  action,
  path,
  value,
}: {
  model: PanelModel
  data: PanelStoreData
  action: ActionMeta
  path: Path
  value: unknown
}) {
  const pinnedPath = useStore(model.store, (s) => s.pinnedPath)
  const isPinned = samePath(path, pinnedPath)
  const history = useMemo(() => actionsTouching(data.actions, path), [data.actions, path])
  const last = lastChangeOf(data.actions, path, action.id)
  const current = valueAt(value, path)

  return (
    <Section variant="muted" padding={3}>
      <VStack gap={2}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <StackItem size="fill">
            <Text type="code" weight="semibold" maxLines={1}>
              {formatPath(path)}
            </Text>
          </StackItem>
          <Button
            label={isPinned ? 'Unpin' : 'Pin path'}
            size="sm"
            variant="secondary"
            icon={<Icon icon={isPinned ? PinOff : Pin} />}
            tooltip={isPinned ? 'Show every action again' : 'Only show actions and changes for this path'}
            onClick={() => model.pinPath(isPinned ? null : path)}
          />
          <IconButton label="Close path history" size="sm" variant="ghost" icon={<Icon icon="close" />} onClick={() => model.selectPath(null)} />
        </HStack>
        <MetadataList label={{ width: 120 }}>
          <MetadataListItem label="Value here">
            {current.found ? <ValueText value={current.value} /> : <Text color="secondary">Not present</Text>}
          </MetadataListItem>
          <MetadataListItem label="Last changed by">
            {last ? (
              <Button
                label={`#${last.action.id} ${last.action.name}`}
                size="sm"
                variant="ghost"
                tooltip="Select this action"
                onClick={() => model.selectAction(last.action.id)}
              />
            ) : (
              <Text color="secondary">No recorded action changed it up to here.</Text>
            )}
          </MetadataListItem>
        </MetadataList>
        {history.length > 0 ? (
          <List
            density="compact"
            hasDividers
            header={
              <Text type="supporting">
                Changed by {history.length} recorded action{history.length === 1 ? '' : 's'}
              </Text>
            }
          >
            {history.map((h) => {
              const change = changesAt(h.changes, path)[0]
              return (
                <ListItem
                  key={h.id}
                  isSelected={h.id === action.id}
                  onClick={() => model.selectAction(h.id)}
                  startContent={
                    <Text type="supporting" hasTabularNumbers>
                      #{h.id}
                    </Text>
                  }
                  label={
                    <Text type="code" maxLines={1}>
                      {h.name}
                    </Text>
                  }
                  description={change && samePath(change.path, path) ? <ChangeValues change={change} /> : undefined}
                />
              )
            })}
          </List>
        ) : null}
        {historyMayBeIncomplete(data.actions) ? (
          <Text type="supporting">Some actions changed more than 200 values, so this history may be incomplete.</Text>
        ) : null}
      </VStack>
    </Section>
  )
}

function DiffView({
  model,
  action,
  range,
  rangeChanges,
  summary,
}: {
  model: PanelModel
  action: ActionMeta
  range: [ActionMeta, ActionMeta] | null
  rangeChanges: { changes: Array<Change>; truncated: boolean } | null
  /** Replaces the "from #a to #b" sentence, e.g. for an async call. */
  summary?: string
}) {
  const showFunctions = useStore(model.store, (s) => s.showFunctions)
  const pinnedPath = useStore(model.store, (s) => s.pinnedPath)

  let all: Array<Change>
  let truncated = false
  if (range) {
    if (!rangeChanges) return <Text color="secondary">Loading both states…</Text>
    all = rangeChanges.changes
    truncated = rangeChanges.truncated
  } else {
    if (action.source === 'init') return <Text color="secondary">Initial state. Nothing to compare with.</Text>
    if (!action.changes) return <Text color="secondary">Diffs are turned off for this store.</Text>
    all = action.changes
    truncated = !!action.changesTruncated
  }
  const scoped = pinnedPath ? changesAt(all, pinnedPath) : all
  const changes = scoped.filter((c) => showFunctions || !isFunctionChange(c))

  return (
    <VStack gap={2}>
      {range ? (
        <Text type="supporting">
          {changes.length} change{changes.length === 1 ? '' : 's'}{' '}
          {summary ?? `from #${range[0].id} ${range[0].name} to #${range[1].id} ${range[1].name}`}.
        </Text>
      ) : null}
      {pinnedPath ? <Text type="supporting">Only changes under {formatPath(pinnedPath)}.</Text> : null}
      {changes.length === 0 ? (
        <Text color="secondary">
          {pinnedPath ? `Nothing under ${formatPath(pinnedPath)} changed.` : 'No changes. The values stayed the same.'}
        </Text>
      ) : (
        <List density="compact" hasDividers edge="flush">
          {changes.map((change, i) => (
            <ListItem
              key={`${formatPath(change.path)}-${i}`}
              align="first-line"
              onClick={() => model.selectPath(change.path)}
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
      )}
      {truncated ? <Text type="supporting">Showing the first {range ? 500 : 200} changes.</Text> : null}
    </VStack>
  )
}

function ChangeValues({ change }: { change: Change }) {
  if (change.kind === 'changed' && isFunctionValue(change.from) && isFunctionValue(change.to)) {
    const after = describe(change.to)
    // The same signature on both sides: only the function's identity changed.
    if (describe(change.from).text === after.text) {
      return (
        <HStack gap={1.5} vAlign="center" wrap="wrap">
          <ValueText described={after} />
          <Text type="supporting">replaced with a new function</Text>
        </HStack>
      )
    }
  }
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

function branchText(branch: { fromId: number; count: number }): string {
  return `Recorded while viewing #${branch.fromId}, so the ${branch.count} action${branch.count === 1 ? '' : 's'} after it ${branch.count === 1 ? 'was' : 'were'} discarded.`
}

function badgeFor(kind: Change['kind']): 'success' | 'error' | 'warning' {
  return kind === 'added' ? 'success' : kind === 'removed' ? 'error' : 'warning'
}

function isFunctionChange(change: Change): boolean {
  const isFn = (v: unknown) => typeof v === 'object' && v !== null && (v as { $t?: string }).$t === 'function'
  return (change.from === undefined || isFn(change.from)) && (change.to === undefined || isFn(change.to))
}

function AsyncCallView({ group }: { group: AsyncGroup }) {
  const error = asyncError(group)
  return (
    <VStack gap={3}>
      <MetadataList label={{ width: 120 }}>
        <MetadataListItem label="Call">
          <Text type="code">{group.key}</Text>
        </MetadataListItem>
        <MetadataListItem label="Status">
          <AsyncStatusToken group={group} />
        </MetadataListItem>
        <MetadataListItem label="Duration">
          {group.durationMs === undefined ? 'Still running' : formatMs(group.durationMs)}
        </MetadataListItem>
        <MetadataListItem label="Started">
          <Text type="code">
            #{group.start.id} {group.start.name} at {formatTime(group.start.ts)}
          </Text>
        </MetadataListItem>
        {group.end ? (
          <MetadataListItem label={group.status === 'rejected' ? 'Failed' : 'Finished'}>
            <Text type="code">
              #{group.end.id} {group.end.name} at {formatTime(group.end.ts)}
            </Text>
          </MetadataListItem>
        ) : null}
        {group.requestId !== undefined ? (
          <MetadataListItem label="Request id">
            <Text type="code">{group.requestId}</Text>
          </MetadataListItem>
        ) : null}
        {error !== undefined ? (
          <MetadataListItem label="Error">
            {/* Wraps instead of truncating: the message is the point. */}
            <Text type="code" data-zi-tone={describe(error).tone}>
              {describe(error, 400).text}
            </Text>
          </MetadataListItem>
        ) : null}
      </MetadataList>
      {group.ambiguous ? <Text type="supporting">{AMBIGUOUS_TEXT}</Text> : null}
      <Text type="supporting">
        Grouped by name: an action ending in :pending starts a call, and one ending in :fulfilled or :rejected
        settles it.
      </Text>
    </VStack>
  )
}

function ActionView({ action }: { action: ActionMeta }) {
  const source = { app: 'App', init: 'Initial state', devtools: 'Devtools' }[action.source]
  const cost = action.cost
  const flags = flagsFor(action)
  return (
    <VStack gap={4}>
      <MetadataList label={{ width: 120 }}>
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
        {action.branch ? (
          <MetadataListItem label="Branch">
            <Text>{branchText(action.branch)}</Text>
          </MetadataListItem>
        ) : null}
        <MetadataListItem label="Changes">
          <Text hasTabularNumbers>{action.changes ? String(action.changes.length) : 'Not recorded'}</Text>
        </MetadataListItem>
        {action.payload !== undefined ? (
          <MetadataListItem label="Payload">
            {kindOf(action.payload) === 'leaf' ? (
              <ValueText value={action.payload} />
            ) : (
              <TreeList density="compact" items={toTreeItems(action.payload, [], true, 0)} />
            )}
          </MetadataListItem>
        ) : null}
      </MetadataList>
      {cost ? (
        <MetadataList label={{ width: 120 }} title={<Text weight="semibold">Cost</Text>}>
          <MetadataListItem label="Time in set()">
            {cost.durationMs !== undefined ? (
              <Text hasTabularNumbers>{formatMs(cost.durationMs)}, listeners included</Text>
            ) : (
              <Text color="secondary">Not measured (needs the inspector middleware)</Text>
            )}
          </MetadataListItem>
          <MetadataListItem label="Listeners">
            {cost.listeners !== undefined ? (
              <Text hasTabularNumbers>{cost.listeners} notified</Text>
            ) : (
              <Text color="secondary">Not measured</Text>
            )}
          </MetadataListItem>
          <MetadataListItem label="State size">
            <Text hasTabularNumbers>{formatSize(cost.stateSize)}</Text>
          </MetadataListItem>
          <MetadataListItem label="Findings">
            {flags.length > 0 ? (
              <VStack gap={1.5}>
                {flags.map((flag) => (
                  <HStack key={flag.kind} gap={2} vAlign="start">
                    <FlagToken flag={flag} />
                    <StackItem size="fill">
                      <Text>{flag.detail}</Text>
                    </StackItem>
                  </HStack>
                ))}
              </VStack>
            ) : (
              <Text color="secondary">Nothing to flag.</Text>
            )}
          </MetadataListItem>
        </MetadataList>
      ) : null}
    </VStack>
  )
}

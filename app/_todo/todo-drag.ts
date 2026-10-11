export const OUTLINE_DRAG_TYPE = 'application/x-ownspire-navi-outline-todo'
export const WORKSPACE_DRAG_TYPE = 'application/x-ownspire-navi-workspace-todo'

export function dragTypesOf(event: React.DragEvent): string[] {
  return Array.from(event.dataTransfer.types)
}

export function hasOutlineDrag(event: React.DragEvent): boolean {
  return dragTypesOf(event).includes(OUTLINE_DRAG_TYPE)
}

export function hasWorkspaceDrag(event: React.DragEvent): boolean {
  return dragTypesOf(event).includes(WORKSPACE_DRAG_TYPE)
}

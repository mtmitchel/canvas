import React, { useEffect, useRef } from 'react';
import Konva from 'konva';
import { useUnifiedCanvasStore } from '../../../stores/unifiedCanvasStore';

type StageRef = React.RefObject<Konva.Stage | null>;

export interface RectangleToolProps {
  isActive: boolean;
  stageRef: StageRef;
  toolId?: string; // default: 'draw-rectangle'
}

function getNamedOrIndexedLayer(stage: Konva.Stage, name: string, indexFallback: number): Konva.Layer | null {
  const named = stage.findOne<Konva.Layer>(`Layer[name='${name}'], #${name}`);
  if (named && named instanceof Konva.Layer) return named;
  const layers = stage.getLayers();
  return layers[indexFallback] ?? null;
}

// FigJam-like default sizes (matches sticky note sizing)
const FIGJAM_RECT_SIZE = { width: 200, height: 120 }; // Slightly wider than tall like FigJam

/**
 * Opens a DOM text editor overlay positioned over a shape element
 */
function openShapeTextEditorForElement(stage: Konva.Stage, elementId: string) {
  const store = useUnifiedCanvasStore.getState();
  
  // Find the element in the store
  const element = store.elements?.find((el: any) => el.id === elementId);
  if (!element) {
    console.warn('[openShapeTextEditor] Element not found:', elementId);
    return;
  }

  // Calculate position in screen coordinates
  const scale = stage.scaleX();
  const stagePos = stage.position();
  const container = stage.container();
  const containerRect = container.getBoundingClientRect();

  // Shape bounds in stage coordinates
  const shapeBounds = {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height
  };

  // Convert to screen coordinates
  const screenX = containerRect.left + (shapeBounds.x * scale) + stagePos.x;
  const screenY = containerRect.top + (shapeBounds.y * scale) + stagePos.y;
  const screenWidth = shapeBounds.width * scale;
  const screenHeight = shapeBounds.height * scale;

  // Create editor element
  const editor = document.createElement('textarea');
  editor.setAttribute('data-text-editor', 'true');
  editor.setAttribute('data-element-id', elementId);
  
  // Get current text or start empty
  const currentText = element.text || element.data?.text || '';
  editor.value = currentText;
  
  // Style the editor - for rectangles, enable word wrapping
  const fontSize = Math.max(14, 16 * scale);
  editor.style.cssText = `
    position: absolute;
    left: ${screenX + 8}px;
    top: ${screenY + 8}px;
    width: ${Math.max(60, screenWidth - 16)}px;
    height: ${Math.max(24, screenHeight - 16)}px;
    z-index: 1000;
    outline: none;
    border: 2px solid #007AFF;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(8px);
    color: #333;
    font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: ${fontSize}px;
    line-height: 1.3;
    padding: 8px;
    resize: none;
    box-sizing: border-box;
    text-align: center;
    overflow-wrap: break-word;
    word-wrap: break-word;
    white-space: pre-wrap;
    overflow-y: auto;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  `;

  document.body.appendChild(editor);

  // Position update function
  function updatePosition() {
    try {
      const currentScale = stage.scaleX();
      const currentStagePos = stage.position();
      const currentContainerRect = container.getBoundingClientRect();
      
      const newScreenX = currentContainerRect.left + (shapeBounds.x * currentScale) + currentStagePos.x;
      const newScreenY = currentContainerRect.top + (shapeBounds.y * currentScale) + currentStagePos.y;
      const newScreenWidth = shapeBounds.width * currentScale;
      const newScreenHeight = shapeBounds.height * currentScale;
      
      editor.style.left = `${newScreenX + 8}px`;
      editor.style.top = `${newScreenY + 8}px`;
      editor.style.width = `${Math.max(60, newScreenWidth - 16)}px`;
      editor.style.height = `${Math.max(24, newScreenHeight - 16)}px`;
      editor.style.fontSize = `${Math.max(14, 16 * currentScale)}px`;
    } catch (error) {
      console.warn('[TextEditor] Error updating position:', error);
    }
  }

  // Listen to stage changes
  const onStageChange = () => updatePosition();
  stage.on('dragmove.text-editor', onStageChange);
  stage.on('scaleXChange.text-editor scaleYChange.text-editor', onStageChange);
  stage.on('xChange.text-editor yChange.text-editor', onStageChange);

  // Cleanup function
  function cleanup() {
    try {
      editor.remove();
    } catch (e) {
      console.warn('[TextEditor] Error removing editor:', e);
    }
    
    stage.off('dragmove.text-editor');
    stage.off('scaleXChange.text-editor scaleYChange.text-editor');
    stage.off('xChange.text-editor yChange.text-editor');
  }

  // Commit function
  function commit(save: boolean = true) {
    const newText = editor.value.trim();
    cleanup();
    
    if (save && store.element?.upsert) {
      store.element.upsert({
        ...element,
        text: newText,
        data: { ...element.data, text: newText }
      });
      console.log('[TextEditor] Updated element text:', newText);
    }
  }

  // Auto-resize function for rectangles (height only, width is fixed)
  function autoResize() {
    const content = editor.value;
    if (!content) return;
    
    // Calculate ideal height based on content
    const lines = content.split('\n');
    const lineHeight = fontSize * 1.3;
    
    // Estimate wrapped lines based on character width and editor width
    const editorWidth = parseInt(editor.style.width) - 16; // Subtract padding
    const charWidth = fontSize * 0.6;
    const charsPerLine = Math.max(1, Math.floor(editorWidth / charWidth));
    
    let totalLines = 0;
    lines.forEach(line => {
      if (line.length === 0) {
        totalLines += 1;
      } else {
        totalLines += Math.ceil(line.length / charsPerLine);
      }
    });
    
    const idealHeight = Math.max(24, totalLines * lineHeight + 16);
    
    // Don't exceed screen bounds
    const maxHeight = Math.min(idealHeight, window.innerHeight * 0.4);
    
    editor.style.height = `${maxHeight}px`;
  }

  // Event handlers
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commit(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      commit(false);
    }
  };

  const onInput = () => {
    autoResize();
  };

  const onBlur = () => {
    setTimeout(() => commit(true), 100);
  };

  // Attach events
  editor.addEventListener('keydown', onKeyDown);
  editor.addEventListener('input', onInput);
  editor.addEventListener('blur', onBlur);

  // Focus and select
  setTimeout(() => {
    editor.focus();
    editor.select();
    autoResize();
  }, 10);

  return cleanup;
}

export const RectangleTool: React.FC<RectangleToolProps> = ({ isActive, stageRef, toolId = 'draw-rectangle' }) => {
  const selectedTool = useUnifiedCanvasStore((s) => s.selectedTool);
  const setSelectedTool = useUnifiedCanvasStore((s) => s.setSelectedTool);
  const upsertElement = useUnifiedCanvasStore((s) => s.element?.upsert);
  const replaceSelectionWithSingle = useUnifiedCanvasStore((s: any) => s.replaceSelectionWithSingle);
  const strokeColor = useUnifiedCanvasStore((s) => s.ui?.strokeColor ?? '#333');
  const fillColor = useUnifiedCanvasStore((s) => s.ui?.fillColor ?? '#ffffff');
  const strokeWidth = useUnifiedCanvasStore((s) => s.ui?.strokeWidth ?? 2);

  const drawingRef = useRef<{
    rect: Konva.Rect | null;
    start: { x: number; y: number } | null;
  }>({ rect: null, start: null });

  useEffect(() => {
    const stage = stageRef.current;
    const active = isActive && selectedTool === toolId;
    if (!stage || !active) return;

    const previewLayer =
      getNamedOrIndexedLayer(stage, 'preview', 2) || stage.getLayers()[stage.getLayers().length - 2] || stage.getLayers()[0];

    const onPointerDown = () => {
      const pos = stage.getPointerPosition();
      if (!pos || !previewLayer) return;

      drawingRef.current.start = { x: pos.x, y: pos.y };

      // Size accounting for current zoom level
      const scale = stage.scaleX();
      const strokeWidthScaled = strokeWidth / scale;

      const rect = new Konva.Rect({
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        stroke: strokeColor,
        strokeWidth: strokeWidthScaled,
        fill: fillColor,
        listening: false,
        perfectDrawEnabled: false,
        name: 'tool-preview-rect',
      });

      drawingRef.current.rect = rect;
      previewLayer.add(rect);
      previewLayer.batchDraw();

      stage.on('pointermove.recttool', onPointerMove);
      stage.on('pointerup.recttool', onPointerUp);
    };

    const onPointerMove = () => {
      const pos = stage.getPointerPosition();
      const layer = previewLayer;
      const rect = drawingRef.current.rect;
      const start = drawingRef.current.start;
      if (!pos || !layer || !rect || !start) return;

      const x = Math.min(start.x, pos.x);
      const y = Math.min(start.y, pos.y);
      const w = Math.abs(pos.x - start.x);
      const h = Math.abs(pos.y - start.y);

      rect.position({ x, y });
      rect.size({ width: w, height: h });
      layer.batchDraw();
    };

    const onPointerUp = () => {
      stage.off('pointermove.recttool');
      stage.off('pointerup.recttool');

      const rect = drawingRef.current.rect;
      const start = drawingRef.current.start;
      const pos = stage.getPointerPosition();
      drawingRef.current.rect = null;
      drawingRef.current.start = null;

      if (!rect || !start || !pos || !previewLayer) return;

      let x = Math.min(start.x, pos.x);
      let y = Math.min(start.y, pos.y);
      let w = Math.abs(pos.x - start.x);
      let h = Math.abs(pos.y - start.y);

      // Remove preview
      rect.remove();
      previewLayer.batchDraw();

      // If click without drag, create default FigJam-sized rectangle
      // Scale size inversely with zoom to maintain consistent visual size
      const scale = stage.scaleX();
      const visualWidth = FIGJAM_RECT_SIZE.width / scale;
      const visualHeight = FIGJAM_RECT_SIZE.height / scale;
      
      if (w < 8 && h < 8) {
        // Single click - center the shape at click point
        x = start.x - visualWidth / 2;
        y = start.y - visualHeight / 2;
        w = visualWidth;
        h = visualHeight;
      } else {
        // Dragged - use actual dimensions but ensure minimum size
        const minSize = 40 / scale;
        w = Math.max(minSize, w);
        h = Math.max(minSize, h);
      }

      // Create element in store
      const id = `rect-${Date.now()}`;
      if (upsertElement) {
        upsertElement({
          id,
          type: 'rectangle',
          x,
          y,
          width: w,
          height: h,
          bounds: { x, y, width: w, height: h },
          draggable: true,
          text: '', // Start with empty text
          data: { text: '' },
          style: {
            stroke: strokeColor,
            strokeWidth,
            fill: fillColor,
          },
        } as any);

        // Select the new rectangle
        try { 
          replaceSelectionWithSingle?.(id as any); 
        } catch (e) {
          console.warn('[RectangleTool] Selection failed:', e);
        }

        // Auto-switch to select tool and open text editor
        setSelectedTool?.('select');
        
        // Small delay to ensure element is rendered before opening editor
        setTimeout(() => {
          openShapeTextEditorForElement(stage, id);
        }, 100);
      }
    };

    // Attach handlers
    stage.on('pointerdown.recttool', onPointerDown);

    return () => {
      stage.off('pointerdown.recttool');
      stage.off('pointermove.recttool');
      stage.off('pointerup.recttool');

      // Cleanup preview
      if (drawingRef.current.rect) {
        drawingRef.current.rect.destroy();
        drawingRef.current.rect = null;
      }
      drawingRef.current.start = null;
      previewLayer?.batchDraw();
    };
  }, [isActive, selectedTool, toolId, stageRef, strokeColor, fillColor, strokeWidth, upsertElement, setSelectedTool, replaceSelectionWithSingle]);

  return null;
};

export default RectangleTool;
import type { ProcessItem, Frame, PageEntry, PageReplacementAlgorithm } from '../types/os';

/**
 * Inicializa la tabla de páginas para un proceso nuevo
 */
export function createPageTable(pagesCount: number): PageEntry[] {
  return Array.from({ length: pagesCount }, (_, i) => ({
    pageNumber: i,
    frameNumber: null,
    inRAM: false,
    lastAccessTick: 0,
    allocatedAtTick: 0,
  }));
}

/**
 * Algoritmo de Selección de Marco Víctima (Reemplazo de Página)
 * Soporta FIFO (el más antiguo) y LRU (el menos recientemente usado)
 */
export function selectVictimFrame(
  frames: Frame[],
  algorithm: PageReplacementAlgorithm,
  currentProcessId: string
): Frame {
  // Preferir marco de otro proceso
  const otherProcessFrames = frames.filter(
    f => f.processId !== null && f.processId !== currentProcessId
  );
  const candidates = otherProcessFrames.length > 0 ? otherProcessFrames : frames;

  if (algorithm === 'FIFO') {
    // FIFO: Menor allocatedAtTick
    return candidates.reduce((oldest, curr) =>
      curr.allocatedAtTick < oldest.allocatedAtTick ? curr : oldest
    );
  } else {
    // LRU: Menor lastAccessTick
    return candidates.reduce((lru, curr) =>
      curr.lastAccessTick < lru.lastAccessTick ? curr : lru
    );
  }
}

/**
 * Algoritmo de Asignación de Memoria MMU
 * Mapea cada página virtual del proceso activo a un Marco Físico en RAM.
 */
export function assignProcessMemory(
  proc: ProcessItem,
  frames: Frame[],
  allProcesses: ProcessItem[],
  currentTick: number,
  algorithm: PageReplacementAlgorithm = 'LRU'
): void {
  proc.pageTable.forEach(page => {
    if (page.inRAM && page.frameNumber !== null) {
      // Ya está en RAM, actualizar timestamp para LRU
      page.lastAccessTick = currentTick;
      const f = frames.find(fr => fr.id === page.frameNumber);
      if (f) f.lastAccessTick = currentTick;
      return;
    }

    // 1. Buscar si hay marco libre en RAM
    let targetFrame = frames.find(f => f.processId === null);

    // 2. Si no hay marcos libres, aplicar Reemplazo (FIFO o LRU)
    if (!targetFrame) {
      targetFrame = selectVictimFrame(frames, algorithm, proc.id);

      // Desalojar la página del proceso anterior (pasa a inválida / disco)
      if (targetFrame.processId !== null) {
        const victimProc = allProcesses.find(p => p.id === targetFrame!.processId);
        if (victimProc && targetFrame.pageNumber !== null) {
          const victimPage = victimProc.pageTable[targetFrame.pageNumber];
          if (victimPage) {
            victimPage.inRAM = false;
            victimPage.frameNumber = null;
          }
        }
      }
    }

    // 3. Asignar el marco físico al proceso actual
    targetFrame.processId = proc.id;
    targetFrame.processName = proc.name;
    targetFrame.color = proc.color;
    targetFrame.pageNumber = page.pageNumber;
    targetFrame.allocatedAtTick = currentTick;
    targetFrame.lastAccessTick = currentTick;

    page.inRAM = true;
    page.frameNumber = targetFrame.id;
    page.allocatedAtTick = currentTick;
    page.lastAccessTick = currentTick;
  });
}

/**
 * Libera todos los marcos físicos de RAM ocupados por un proceso terminado
 */
export function releaseProcessMemory(
  proc: ProcessItem,
  frames: Frame[]
): void {
  frames.forEach(frame => {
    if (frame.processId === proc.id) {
      frame.processId = null;
      frame.processName = null;
      frame.color = null;
      frame.pageNumber = null;
      frame.allocatedAtTick = 0;
      frame.lastAccessTick = 0;
    }
  });

  proc.pageTable.forEach(page => {
    page.inRAM = false;
    page.frameNumber = null;
  });
}

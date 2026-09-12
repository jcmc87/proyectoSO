import type { ProcessItem, Frame, PageEntry, PageReplacementAlgorithm } from '../types/os';

/**
 * Puntero circular para el Algoritmo del Reloj / Segunda Oportunidad
 */
let clockHandPointer = 0;

export function getClockHandPointer(): number {
  return clockHandPointer;
}

export function resetClockHandPointer(): void {
  clockHandPointer = 0;
}

/**
 * Inicializa la tabla de páginas para un proceso nuevo
 */
export function createPageTable(pagesCount: number): PageEntry[] {
  return Array.from({ length: pagesCount }, (_, i) => ({
    pageNumber: i,
    frameNumber: null,
    inRAM: false,
    referenceBit: 1,
    lastAccessTick: 0,
    allocatedAtTick: 0,
  }));
}

/**
 * Algoritmo de Selección de Marco Víctima (Reemplazo de Página)
 * Soporta:
 * 1. FIFO (El marco cargado hace más tiempo)
 * 2. LRU (El marco menos recientemente usado)
 * 3. CLOCK / Segunda Oportunidad (Manecilla circular con bit de referencia R)
 */
export function selectVictimFrame(
  frames: Frame[],
  algorithm: PageReplacementAlgorithm,
  currentProcessId: string
): Frame {
  if (frames.length === 0) return frames[0];

  // 1. ALGORITMO DEL RELOJ / SEGUNDA OPORTUNIDAD (CLOCK / SECOND CHANCE)
  if (algorithm === 'CLOCK') {
    const totalFrames = frames.length;
    let iterations = 0;
    // Hasta 2 vueltas completas para garantizar encontrar una víctima
    while (iterations < totalFrames * 2) {
      const currentFrame = frames[clockHandPointer];

      // Si el marco no pertenece al proceso actual (o es el único candidato)
      if (currentFrame.referenceBit === 1) {
        // Segunda oportunidad: apagamos el bit de uso (R = 0) y avanzamos la manecilla
        currentFrame.referenceBit = 0;
        clockHandPointer = (clockHandPointer + 1) % totalFrames;
      } else {
        // Encontrado: bit R = 0 -> Este es el marco víctima
        const victim = currentFrame;
        clockHandPointer = (clockHandPointer + 1) % totalFrames;
        return victim;
      }
      iterations++;
    }
    // Si todos tenían R=1, tras la primera vuelta todos son R=0, seleccionamos el actual
    const victim = frames[clockHandPointer];
    clockHandPointer = (clockHandPointer + 1) % totalFrames;
    return victim;
  }

  // 2. FIFO y LRU
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
      // Ya está en RAM, actualizar bit de referencia (Segunda Oportunidad) y timestamp (LRU)
      page.referenceBit = 1;
      page.lastAccessTick = currentTick;
      const f = frames.find(fr => fr.id === page.frameNumber);
      if (f) {
        f.referenceBit = 1;
        f.lastAccessTick = currentTick;
      }
      return;
    }

    // 1. Buscar si hay marco libre en RAM
    let targetFrame = frames.find(f => f.processId === null);

    // 2. Si no hay marcos libres, aplicar Reemplazo (CLOCK, FIFO o LRU)
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
            victimPage.referenceBit = 0;
          }
        }
      }
    }

    // 3. Asignar el marco físico al proceso actual
    targetFrame.processId = proc.id;
    targetFrame.processName = proc.name;
    targetFrame.color = proc.color;
    targetFrame.pageNumber = page.pageNumber;
    targetFrame.referenceBit = 1; // Bit R = 1 al cargarse
    targetFrame.allocatedAtTick = currentTick;
    targetFrame.lastAccessTick = currentTick;

    page.inRAM = true;
    page.frameNumber = targetFrame.id;
    page.referenceBit = 1;
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
      frame.referenceBit = 0;
      frame.allocatedAtTick = 0;
      frame.lastAccessTick = 0;
    }
  });

  proc.pageTable.forEach(page => {
    page.inRAM = false;
    page.frameNumber = null;
    page.referenceBit = 0;
  });
}

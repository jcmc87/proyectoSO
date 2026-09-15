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
export function selectVictimFrame(frames: Frame[], pageReplacement: PageReplacementAlgorithm): Frame | null {
  if (frames.length === 0) return frames[0];

  // 1. ALGORITMO DEL RELOJ / SEGUNDA OPORTUNIDAD (CLOCK / SECOND CHANCE)
  if (pageReplacement === 'CLOCK') {
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

  // 2. FIFO y SEGUNDA OPORTUNIDAD (Reemplazo Global Puro)
  const filledFrames = frames.filter(f => f.processId !== null);
  const candidates = filledFrames.length > 0 ? filledFrames : frames;

  if (pageReplacement === 'FIFO') {
    // FIFO: Menor allocatedAtTick
    return candidates.reduce((oldest, curr) =>
      curr.allocatedAtTick < oldest.allocatedAtTick ? curr : oldest
    );
  } else {
    // SECOND_CHANCE: Simular una cola FIFO
    const fifoQueue = [...candidates].sort((a, b) => a.allocatedAtTick - b.allocatedAtTick);
    
    // Hasta 2 vueltas por la cola para encontrar una víctima
    for (let i = 0; i < fifoQueue.length * 2; i++) {
      const oldest = fifoQueue[0];
      if (oldest.referenceBit === 1) {
        // Segunda oportunidad: apagamos el bit, y lo enviamos al fondo de la cola (actualizando su allocatedAtTick)
        oldest.referenceBit = 0;
        const maxTick = Math.max(...fifoQueue.map(f => f.allocatedAtTick));
        oldest.allocatedAtTick = maxTick + 1;
        
        // Rotar la cola (sale del frente, entra al fondo)
        fifoQueue.shift();
        fifoQueue.push(oldest);
      } else {
        return oldest; // Encontrado un bit 0
      }
    }
    
    return fifoQueue[0];
  }
}

/**
 * Comprueba si un proceso tiene páginas virtuales no cargadas en memoria física RAM (Fallo de Página)
 */
export function checkProcessPageFault(proc: ProcessItem): boolean {
  return proc.pageTable.some(page => !page.inRAM || page.frameNumber === null);
}

/**
 * Algoritmo de Asignación de Memoria MMU (Evalúa una sola página por tick)
 * Mapea la página solicitada a un Marco Físico en RAM.
 * Retorna true si hubo Fallo de Página ('x'), false si fue Acierto ('//').
 */
export function assignProcessMemory(
  proc: ProcessItem,
  frames: Frame[],
  allProcesses: ProcessItem[],
  currentTick: number,
  algorithm: PageReplacementAlgorithm,
  pageIndex: number
): boolean {
  const page = proc.pageTable[pageIndex];

  if (page.inRAM && page.frameNumber !== null) {
    // ACIERTO (HIT) '//'
    page.referenceBit = 1;
    page.lastAccessTick = currentTick;
    const f = frames.find(fr => fr.id === page.frameNumber);
    if (f) {
      f.referenceBit = 1;
      f.lastAccessTick = currentTick;
    }
    return false; // No hubo fallo
  }

  // FALLO DE PÁGINA (FAULT) 'x'
  
  // 1. Buscar si hay marco libre en RAM
  let targetFrame = frames.find(f => f.processId === null);

  // 2. Si no hay marcos libres, aplicar Reemplazo Global (CLOCK, FIFO o LRU)
  if (!targetFrame) {
    const victim = selectVictimFrame(frames, algorithm);
    if (!victim) return true; // Failsafe
    targetFrame = victim;

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

  return true; // Hubo fallo
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

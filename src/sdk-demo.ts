import {
  BundledThemeProvider,
  DRAFTROLL_THEME_SCHEMA_VERSION,
  DiceRoom,
  decodeNormalizedRollResult,
  Draftroll,
  SeededRng,
  type DiceRng,
  type DisplayRollInput,
  type NormalizedRollResult,
  type RendererPlayOptions,
  type RollUpdateInput,
  type SynchronizedRollStart,
  type SynchronizedRollUpdate,
} from '../packages/sdk/src/index';

interface HistoryResponse {
  rolls?: Array<{ result?: unknown }>;
}

type LogAction = 'select' | 'reroll-all' | 'reroll-die' | 'load';

const tableOptions = (
  groupId: string,
  actorLabel: string,
  rollLabel: string,
): RendererPlayOptions['table'] => ({
  mode: 'concurrent',
  groupId,
  actorLabel,
  rollLabel,
  batchWindowMs: 140,
  maximumConcurrentRolls: 6,
  maximumConcurrentVisuals: 30,
});

const logButton = (label: string, action: LogAction, rollId: string, dieId?: string): HTMLButtonElement => {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.dataset.action = action;
  element.dataset.rollId = rollId;
  if (dieId) element.dataset.dieId = dieId;
  return element;
};

export async function initSdkDemo(): Promise<void> {
  const expressionInput = requireElement<HTMLInputElement>('#sdk-expression');
  const themeInput = requireElement<HTMLSelectElement>('#sdk-theme');
  const rollNameInput = requireElement<HTMLInputElement>('#sdk-roll-name');
  const actionNameInput = requireElement<HTMLInputElement>('#sdk-action-name');
  const characterNameInput = requireElement<HTMLInputElement>('#sheet-character-name');
  const rollButton = requireElement<HTMLButtonElement>('#sdk-roll');
  const fixedEnabledInput = requireElement<HTMLInputElement>('#sdk-fixed-enabled');
  const fixedResultsInput = requireElement<HTMLInputElement>('#sdk-fixed-results');
  const fixedExampleButton = requireElement<HTMLButtonElement>('#sdk-fixed-example');
  const fixedHint = requireElement<HTMLElement>('#sdk-fixed-hint');
  const fixedPanel = fixedEnabledInput.closest<HTMLElement>('.fixed-results-panel');
  const roomServerInput = requireElement<HTMLInputElement>('#sdk-room-server');
  const roomIdInput = requireElement<HTMLInputElement>('#sdk-room-id');
  const roomPasswordInput = requireElement<HTMLInputElement>('#sdk-room-password');
  const roomConnectButton = requireElement<HTMLButtonElement>('#sdk-room-connect');
  const roomRollButton = requireElement<HTMLButtonElement>('#sdk-room-roll');
  const updateRollButton = requireElement<HTMLButtonElement>('#sdk-update-roll');
  const updateLogButton = requireElement<HTMLButtonElement>('#sdk-update-log');
  const refreshLogButton = requireElement<HTMLButtonElement>('#sdk-refresh-log');
  const clearTableButton = requireElement<HTMLButtonElement>('#sdk-clear-table');
  const stageTwoRollsButton = requireElement<HTMLButtonElement>('#sdk-stage-two-rolls');
  const secondRollNameInput = requireElement<HTMLInputElement>('#sdk-second-roll-name');
  const secondActionNameInput = requireElement<HTMLInputElement>('#sdk-second-action-name');
  const secondExpressionInput = requireElement<HTMLInputElement>('#sdk-second-expression');
  const secondFixedResultsInput = requireElement<HTMLInputElement>('#sdk-second-fixed-results');
  const secondDelayInput = requireElement<HTMLInputElement>('#sdk-second-delay');
  const tableTestStatus = requireElement<HTMLElement>('#sdk-table-test-status');
  const roomStatus = requireElement<HTMLElement>('#sdk-room-status');
  const overlayStatus = requireElement<HTMLElement>('#sdk-overlay-status');
  const logElement = requireElement<HTMLElement>('#sdk-dice-log');
  const output = requireElement<HTMLElement>('#sdk-output');

  const show = (value: unknown) => {
    output.textContent = JSON.stringify(value, null, 2);
  };
  const showError = (error: unknown) => {
    output.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  };

  overlayStatus.textContent = 'LOADING RENDERER';
  const testThemeProvider = new BundledThemeProvider([{
    schemaVersion: DRAFTROLL_THEME_SCHEMA_VERSION,
    id: 'test-obsidian',
    name: 'Obsidian Test',
    version: '1.0.0',
    description: 'Local constrained runtime-theme test manifest.',
    availableDice: ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'],
    material: {
      color: '#17131f',
      emissive: '#3d1859',
      emissiveIntensity: 0.34,
      roughness: 0.36,
      metalness: 0.42,
      clearcoat: 0.48,
      clearcoatRoughness: 0.2,
    },
    labels: {
      color: '#f8eaff',
      glowColor: '#c468ff',
      fontFamily: 'Georgia',
    },
    effects: {
      positive: 'major-burst',
      neutral: 'subtle-pulse',
      negative: 'void-fracture',
    },
    metadata: {
      edgeColor: '#b45cff',
      particleColor: '#d8a4ff',
      surfaceAudio: {
        impactSet: 'crystal',
        pitchRange: [0.92, 1.08],
        resonance: 0.72,
        weight: 1.05,
        brightness: 0.8,
      },
    },
  }]);
  const draftroll = await Draftroll.createOverlay({
    overlay: {
      src: '/overlay.html',
      dismissOnPointer: true,
      dismissIgnoreSelector: '[data-draftroll-preserve-table]',
      dismissDurationMs: 360,
      dismissResultPanel: true,
      themeProvider: testThemeProvider,
      fallbackThemeId: 'dragon',
      onThemeLoad: (event) => {
        overlayStatus.textContent = event.type === 'complete' ? 'SDK OVERLAY READY' : `THEME ${event.type.toUpperCase()}`;
      },
      results: {
        position: 'bottom-right',
        title: 'Latest roll',
        allowReroll: false,
        showThemes: true,
      },
    },
    warmupThemes: ['dragon', 'test-obsidian'],
  });
  overlayStatus.textContent = 'SDK OVERLAY READY';
  show({
    ready: true,
    renderer: 'DraftrollOverlayRenderer',
    behavior: 'Dice are absent until a roll and dissolve on the next pointer click.',
  });

  const logById = new Map<string, NormalizedRollResult>();
  const logOrder: string[] = [];
  const pendingPresentationIds = new Map<string, number>();
  const pendingRoomAnimations = new Map<string, 'all' | string[]>();
  let room: DiceRoom | null = null;
  let roomUnsubscribers: Array<() => void> = [];
  let selectedRollId: string | null = null;

  const setBusy = (busy: boolean) => {
    // Ordinary table rolls remain available while another throw is active.
    // The persistent renderer can inject a second handful into the same world.
    rollButton.disabled = false;
    roomRollButton.disabled = room === null;
    stageTwoRollsButton.disabled = busy;
    updateRollButton.disabled = busy || selectedRollId === null;
    updateLogButton.disabled = busy || selectedRollId === null;
  };

  const setRoomStatus = (label: string, connected: boolean, connecting = false) => {
    roomStatus.textContent = label;
    roomStatus.classList.toggle('connected', connected);
    roomStatus.classList.toggle('connecting', connecting);
    roomConnectButton.textContent = connected ? 'Disconnect room' : connecting ? 'Connecting…' : 'Connect room';
    roomRollButton.disabled = !connected;
  };

  const actorName = () => rollNameInput.value.trim() || characterNameInput.value.trim() || 'Anonymous';
  const actionName = () => actionNameInput.value.trim() || 'Unnamed roll';
  const rollMetadata = () => ({
    source: 'character-sheet-test-client',
    actionName: actionName(),
    characterName: actorName(),
    characterClass: document.querySelector<HTMLInputElement>('#sheet-character-class')?.value.trim() || undefined,
    characterLevel: Number(document.querySelector<HTMLInputElement>('#sheet-character-level')?.value || 0) || undefined,
  });



  const buildFixedDisplayInput = (
    expression: string,
    valuesText: string,
    name: string,
    label: string,
    themeId: string,
    metadata: Record<string, unknown>,
  ): Omit<DisplayRollInput, 'mode'> => {
    const values = parseFixedValues(valuesText);
    if (values.length === 0) throw new Error('Enter at least one predetermined result');
    const rng = new FixedSequenceRng(values);
    const evaluated = draftroll.engine.roll(expression, {
      rng,
      name,
      themeId,
      metadata: { ...metadata, actionName: label, predeterminedResults: true },
    });
    if (rng.remaining > 0) {
      throw new Error(`The formula consumed ${rng.used} result${rng.used === 1 ? '' : 's'}, but ${values.length} were supplied`);
    }
    return {
      name,
      expression,
      total: evaluated.total,
      themeId,
      annotation: evaluated.annotation,
      comment: evaluated.comment,
      metadata: {
        ...metadata,
        actionName: label,
        predeterminedResults: true,
        requestedResults: values,
      },
      dice: evaluated.dice.map((die) => ({
        id: die.id,
        type: die.type,
        sides: die.sides,
        result: die.result,
        numericValue: die.numericValue,
        faceIndex: die.faceIndex,
        themeId: die.themeId ?? themeId,
        customDiceId: die.customDiceId,
        appearance: die.appearance,
        physics: die.physics,
        sourceRollIndex: die.sourceRollIndex,
        generatedBy: die.generatedBy,
        generatedFromDieId: die.generatedFromDieId,
        annotations: die.annotations,
        metadata: die.metadata,
        kept: die.kept,
      })),
      customDice: evaluated.customDice,
    };
  };

  const refreshFixedHint = () => {
    fixedPanel?.classList.toggle('enabled', fixedEnabledInput.checked);
    const dice = describeFormulaDice(expressionInput.value);
    const values = parseFixedValuesLenient(fixedResultsInput.value);
    const summary = dice.length > 0 ? dice.join(', ') : 'no dice detected';
    fixedHint.textContent = fixedEnabledInput.checked
      ? `Formula order: ${summary}. Supplied ${values.length} value${values.length === 1 ? '' : 's'}.`
      : `Enable to force the detected dice (${summary}) to land on exact values.`;
  };

  const upsertLog = (incoming: NormalizedRollResult, select = true) => {
    if (!incoming.rollId) throw new Error('A logged roll must have a rollId');
    if (!logById.has(incoming.rollId)) logOrder.unshift(incoming.rollId);
    logById.set(incoming.rollId, incoming);
    if (select) selectedRollId = incoming.rollId;
    renderLog();
    show(pendingPresentationIds.has(incoming.rollId)
      ? { rollId: incoming.rollId, status: 'rolling', expression: incoming.expression, name: incoming.name }
      : incoming);
  };

  const trackPresentation = (response: { result: NormalizedRollResult; wait(): Promise<unknown> }) => {
    const rollId = response.result.rollId;
    if (!rollId) throw new Error('A presented roll must have a rollId');
    const generation = (pendingPresentationIds.get(rollId) ?? 0) + 1;
    pendingPresentationIds.set(rollId, generation);
    upsertLog(response.result);
    void response.wait().then(() => {
      if (pendingPresentationIds.get(rollId) !== generation) return;
      pendingPresentationIds.delete(rollId);
      renderLog();
      show(response.result);
    }, (error) => {
      if (pendingPresentationIds.get(rollId) !== generation) return;
      pendingPresentationIds.delete(rollId);
      renderLog();
      showError(error);
    });
  };

  const populateEditor = (result: NormalizedRollResult) => {
    selectedRollId = result.rollId ?? null;
    rollNameInput.value = result.name
      ?? (typeof result.metadata?.characterName === 'string' ? result.metadata.characterName : characterNameInput.value);
    characterNameInput.value = rollNameInput.value;
    actionNameInput.value = typeof result.metadata?.actionName === 'string' ? result.metadata.actionName : result.annotation ?? 'Roll';
    expressionInput.value = result.expression ?? expressionInput.value;
    if (result.themeId) themeInput.value = result.themeId;
    setBusy(false);
    renderLog();
  };


  const renderLog = () => {
    logElement.replaceChildren();
    if (logOrder.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-log';
      empty.textContent = 'No rolls yet. Connect and roll a formula.';
      logElement.append(empty);
      return;
    }

    for (const rollId of logOrder) {
      const result = logById.get(rollId);
      if (!result) continue;
      const pending = pendingPresentationIds.has(rollId);
      const entry = document.createElement('article');
      entry.className = `log-entry${selectedRollId === rollId ? ' selected' : ''}`;

      const head = document.createElement('div');
      head.className = 'log-entry-head';
      head.dataset.action = 'select';
      head.dataset.rollId = rollId;

      const copy = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'log-entry-title';
      const actor = document.createElement('strong');
      actor.textContent = result.name ?? 'Anonymous';
      const action = document.createElement('span');
      action.textContent = typeof result.metadata?.actionName === 'string' ? result.metadata.actionName : result.annotation ?? 'Roll';
      title.append(actor, action);
      const formula = document.createElement('div');
      formula.className = 'log-formula';
      formula.textContent = result.expression ?? 'Structured / external roll';
      const meta = document.createElement('div');
      meta.className = 'log-meta';
      meta.textContent = `${result.authority} · revision ${result.revision ?? 0} · ${new Date(result.updatedAt ?? result.createdAt).toLocaleTimeString()}${pending ? ' · rolling' : ''}`;
      copy.append(title, formula, meta);

      const total = document.createElement('div');
      total.className = 'log-entry-total';
      total.textContent = pending ? '…' : String(result.total);
      head.append(copy, total);

      const diceRow = document.createElement('div');
      diceRow.className = `log-dice${pending ? ' pending' : ''}`;
      if (pending) {
        // The complete deterministic result already contains future modifier
        // descendants. A placeholder per die would disclose the final number
        // of explosions/rerolls before the physical sequence finishes.
        const hidden = document.createElement('span');
        hidden.className = 'log-results-hidden';
        hidden.textContent = 'Results hidden until all dice settle';
        diceRow.append(hidden);
      } else {
        result.dice.forEach((die) => {
          const dieButton = logButton(`${die.type.toUpperCase()} ${String(die.result)}`, 'reroll-die', rollId, die.id);
          dieButton.className = `die-result-button${die.kept ? '' : ' dropped'}`;
          dieButton.title = `Reroll ${die.id}`;
          const theme = document.createElement('small');
          theme.textContent = die.themeId ?? result.themeId ?? 'default';
          dieButton.append(theme);
          diceRow.append(dieButton);
        });
      }

      const actions = document.createElement('div');
      actions.className = 'log-entry-actions';
      actions.append(
        logButton('Reroll all', 'reroll-all', rollId),
        logButton('Load formula', 'load', rollId),
      );
      actions.querySelectorAll('button').forEach((button) => { button.disabled = pending; });

      entry.append(head, diceRow, actions);
      logElement.append(entry);
    }
  };

  const presentRoomResult = (result: NormalizedRollResult, options: RendererPlayOptions = {}) => {
    const response = draftroll.present(result, options);
    trackPresentation(response);
  };

  const handleRoomStart = (event: SynchronizedRollStart) => {
    if (!event.result) {
      show({ hidden: true, actor: event.actor, summary: event.summary });
      return;
    }
    const roomActor = event.result.name ?? event.actor.name ?? 'Anonymous';
    const roomAction = typeof event.result.metadata?.actionName === 'string'
      ? event.result.metadata.actionName
      : event.result.annotation ?? 'Roll';
    presentRoomResult(event.result, {
      startTime: event.localStartTimeMs,
      animationSeed: event.animationSeed,
      table: tableOptions(event.result.rollId ?? event.clientRollId ?? crypto.randomUUID(), roomActor, roomAction),
    });
  };

  const handleRoomUpdate = (event: SynchronizedRollUpdate) => {
    if (!event.result) {
      show({ hidden: true, actor: event.actor, summary: event.summary });
      return;
    }
    const rollId = event.result.rollId;
    const previous = rollId ? logById.get(rollId) : undefined;
    const requestedAnimation = rollId ? pendingRoomAnimations.get(rollId) : undefined;
    if (rollId) pendingRoomAnimations.delete(rollId);
    const changedDieIds = previous ? changedDice(previous, event.result) : undefined;
    const animatedDieIds = requestedAnimation === 'all'
      ? undefined
      : requestedAnimation ?? (changedDieIds?.length && changedDieIds.length < event.result.dice.length ? changedDieIds : undefined);

    if (event.animate) {
      presentRoomResult(event.result, {
        startTime: event.localStartTimeMs,
        animationSeed: event.animationSeed,
        dieIds: animatedDieIds,
      });
    } else {
      const response = draftroll.presentUpdate(event.result);
      upsertLog(response.result);
    }
  };

  const roomHistoryRequest = () => {
    const base = new URL(roomServerInput.value.trim());
    base.pathname = `/rooms/${encodeURIComponent(roomIdInput.value.trim())}/history`;
    base.search = '?limit=50';
    base.searchParams.set('protocolVersion', '2');
    if (room) return room.authorizeHttpRequest(base);
    const headers = new Headers();
    if (roomPasswordInput.value) headers.set('X-Draftroll-Room-Password', roomPasswordInput.value);
    return new Request(base, { headers });
  };

  const loadHistory = async () => {
    const roomId = roomIdInput.value.trim();
    if (!roomId) throw new Error('Room ID is required');
    const response = await fetch(roomHistoryRequest());
    if (!response.ok) throw new Error(`History request failed with ${response.status}`);
    const history = await response.json() as HistoryResponse;
    const results = (history.rolls ?? [])
      .map((entry) => decodeNormalizedRollResult(entry.result, { allowLegacyResults: true }))
      .filter((decoded) => decoded.success)
      .map((decoded) => decoded.data);
    for (const result of results.toReversed()) upsertLog(result, false);
    renderLog();
  };

  const launchLocalRoll = (
    expression: string,
    name: string,
    label: string,
    themeId: string,
    metadata: Record<string, unknown>,
    fixedValues?: string,
  ) => {
    const seed = crypto.randomUUID();
    const renderer: RendererPlayOptions = {
      animationSeed: seed,
      table: tableOptions(seed, name, label),
    };
    const response = fixedValues !== undefined
      ? draftroll.display(buildFixedDisplayInput(expression, fixedValues, name, label, themeId, metadata), renderer)
      : draftroll.roll(expression, {
          rng: new SeededRng(seed),
          name,
          themeId,
          metadata: { ...metadata, actionName: label },
          renderer,
        });
    trackPresentation(response);
    return response;
  };

  const submitLocalRoll = async () => {
    const response = launchLocalRoll(
      expressionInput.value,
      actorName(),
      actionName(),
      themeInput.value,
      rollMetadata(),
      fixedEnabledInput.checked ? fixedResultsInput.value : undefined,
    );
    await response.wait();
  };


  const launchRoomRoll = async (
    expression: string,
    name: string,
    label: string,
    themeId: string,
    metadata: Record<string, unknown>,
    fixedValues?: string,
  ) => {
    if (!room) throw new Error('Connect to a room first');
    if (fixedValues !== undefined) {
      return room.displayRoll(buildFixedDisplayInput(expression, fixedValues, name, label, themeId, metadata));
    }
    return room.roll({
      mode: 'evaluate',
      name,
      expression,
      themeId,
      metadata: { ...metadata, actionName: label },
    });
  };

  const launchConfiguredRoll = (
    expression: string,
    name: string,
    label: string,
    themeId: string,
    metadata: Record<string, unknown>,
    fixedValues?: string,
  ) => room
    ? launchRoomRoll(expression, name, label, themeId, metadata, fixedValues)
    : Promise.resolve(launchLocalRoll(expression, name, label, themeId, metadata, fixedValues));

  const updateSelected = async (animate: boolean) => {
    if (!selectedRollId) throw new Error('Select a roll from the dice log first');
    const previous = logById.get(selectedRollId);
    if (!previous) throw new Error('Selected roll no longer exists');
    const update: RollUpdateInput = {
      name: actorName(),
      expression: expressionInput.value,
      themeId: themeInput.value,
      metadata: rollMetadata(),
    };

    if (room && previous.sequence !== undefined) {
      if (animate) pendingRoomAnimations.set(selectedRollId, 'all');
      try {
        await room.updateRoll(selectedRollId, update, { reroll: animate, animate });
      } catch (error) {
        pendingRoomAnimations.delete(selectedRollId);
        throw error;
      }
      return;
    }

    const response = draftroll.updateRoll(previous, update, {
      mode: animate ? 'animate' : 'log-only',
      reroll: animate,
      allowGenerateMissing: animate,
      renderer: animate ? { animationSeed: crypto.randomUUID() } : undefined,
    });
    if (animate) trackPresentation(response);
    else upsertLog(response.result);
    await response.wait();
  };

  const reroll = async (rollId: string, dieIds?: string[]) => {
    const previous = logById.get(rollId);
    if (!previous) throw new Error(`Roll '${rollId}' is not in the local log`);
    selectedRollId = rollId;
    if (room && previous.sequence !== undefined) {
      pendingRoomAnimations.set(rollId, dieIds ?? 'all');
      try {
        await room.updateRoll(rollId, {}, { reroll: dieIds ?? true, animate: true });
      } catch (error) {
        pendingRoomAnimations.delete(rollId);
        throw error;
      }
      return;
    }

    const ids = dieIds ?? previous.dice
      .filter((die) => die.generatedBy === 'initial' || die.generatedBy === 'external' || die.generatedBy === undefined)
      .map((die) => die.id);
    const response = draftroll.rerollDice(previous, ids, {
      renderer: { animationSeed: crypto.randomUUID() },
    });
    trackPresentation(response);
    await response.wait();
  };

  characterNameInput.addEventListener('input', () => {
    rollNameInput.value = characterNameInput.value;
  });
  rollNameInput.addEventListener('input', () => {
    characterNameInput.value = rollNameInput.value;
  });

  document.querySelectorAll<HTMLButtonElement>('.formula-preset').forEach((preset) => {
    preset.addEventListener('click', () => {
      expressionInput.value = preset.dataset.formula ?? expressionInput.value;
      actionNameInput.value = preset.dataset.action ?? actionNameInput.value;
      refreshFixedHint();
      expressionInput.focus();
    });
  });

  rollButton.addEventListener('click', () => {
    void submitLocalRoll().catch(showError);
  });

  roomConnectButton.addEventListener('click', () => {
    void (async () => {
      if (room) {
        roomUnsubscribers.forEach((unsubscribe) => unsubscribe());
        roomUnsubscribers = [];
        room.close();
        room = null;
        setRoomStatus('OFFLINE', false);
        setBusy(false);
        return;
      }

      roomConnectButton.disabled = true;
      setRoomStatus('CONNECTING', false, true);
      try {
        const roomId = roomIdInput.value.trim();
        if (!roomId) throw new Error('Room ID is required');
        const serverUrl = new URL(roomServerInput.value.trim());
        serverUrl.protocol = serverUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        serverUrl.pathname = `/rooms/${encodeURIComponent(roomId)}/connect`;
        serverUrl.search = '';

        const connectedRoom = await DiceRoom.connect({
          url: serverUrl.toString(),
          roomId,
          reconnect: true,
          participant: { name: actorName() },
          roomPassword: roomPasswordInput.value || undefined,
        });
        room = connectedRoom;
        roomUnsubscribers = [
          connectedRoom.on('rollStart', handleRoomStart),
          connectedRoom.on('rollUpdate', handleRoomUpdate),
          connectedRoom.on('roomState', (event) => {
            if (event.recentRoll?.result) upsertLog(event.recentRoll.result, false);
            show(event);
          }),
          connectedRoom.on('rollError', (event) => showError(new Error(event.message))),
          connectedRoom.on('error', ({ error }) => showError(error)),
          connectedRoom.on('close', () => {
            room = null;
            roomUnsubscribers = [];
            setRoomStatus('OFFLINE', false);
            setBusy(false);
          }),
        ];
        connectedRoom.markReady();
        setRoomStatus('CONNECTED', true);
        setBusy(false);
        await loadHistory().catch(showError);
      } catch (error) {
        showError(error);
        setRoomStatus('OFFLINE', false);
      } finally {
        roomConnectButton.disabled = false;
      }
    })();
  });

  roomRollButton.addEventListener('click', () => {
    if (!room) return;
    try {
      void launchRoomRoll(
        expressionInput.value,
        actorName(),
        actionName(),
        themeInput.value,
        rollMetadata(),
        fixedEnabledInput.checked ? fixedResultsInput.value : undefined,
      ).catch(showError);
    } catch (error) {
      showError(error);
    }
  });

  fixedEnabledInput.addEventListener('change', refreshFixedHint);
  fixedResultsInput.addEventListener('input', refreshFixedHint);
  expressionInput.addEventListener('input', refreshFixedHint);
  fixedExampleButton.addEventListener('click', () => {
    const examples = exampleResultsForFormula(expressionInput.value);
    if (examples.length === 0) {
      showError(new Error('No dice were detected in the current formula'));
      return;
    }
    fixedResultsInput.value = examples.join(', ');
    fixedEnabledInput.checked = true;
    refreshFixedHint();
  });

  clearTableButton.addEventListener('click', () => {
    void draftroll.clearDice().catch(showError);
  });

  stageTwoRollsButton.addEventListener('click', () => {
    void (async () => {
      setBusy(true);
      tableTestStatus.textContent = 'Starting first roller…';
      tableTestStatus.className = 'table-test-status running';
      try {
        const first = launchConfiguredRoll(
          expressionInput.value,
          actorName(),
          actionName(),
          themeInput.value,
          rollMetadata(),
          fixedEnabledInput.checked ? fixedResultsInput.value : undefined,
        );
        const delayMs = Math.min(3_000, Math.max(0, Number(secondDelayInput.value) || 0));
        tableTestStatus.textContent = `Second roller enters in ${delayMs} ms…`;
        await delay(delayMs);
        const secondName = secondRollNameInput.value.trim() || 'Second roller';
        const secondLabel = secondActionNameInput.value.trim() || 'Second roll';
        const secondMetadata = {
          source: 'character-sheet-table-test',
          actionName: secondLabel,
          characterName: secondName,
          simulatedSecondParticipant: true,
        };
        const second = launchConfiguredRoll(
          secondExpressionInput.value,
          secondName,
          secondLabel,
          themeInput.value,
          secondMetadata,
          secondFixedResultsInput.value.trim() || undefined,
        );
        const [firstStarted, secondStarted] = await Promise.all([first, second]);
        await Promise.all([waitForPlaygroundPresentation(firstStarted), waitForPlaygroundPresentation(secondStarted)]);
        tableTestStatus.textContent = 'Both rolls shared the same table';
        tableTestStatus.className = 'table-test-status complete';
      } catch (error) {
        tableTestStatus.textContent = 'Table test failed';
        tableTestStatus.className = 'table-test-status';
        showError(error);
      } finally {
        setBusy(false);
      }
    })();
  });

  updateRollButton.addEventListener('click', () => void updateSelected(true).catch(showError));
  updateLogButton.addEventListener('click', () => void updateSelected(false).catch(showError));
  refreshLogButton.addEventListener('click', () => void loadHistory().catch(showError));

  logElement.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action][data-roll-id]');
    if (!target) return;
    const rollId = target.dataset.rollId;
    const action = target.dataset.action as LogAction | undefined;
    if (!rollId || !action) return;
    const result = logById.get(rollId);
    if (!result) return;

    if (action === 'select' || action === 'load') {
      populateEditor(result);
      return;
    }
    if (action === 'reroll-all') {
      void reroll(rollId).catch(showError);
      return;
    }
    if (action === 'reroll-die' && target.dataset.dieId) {
      void reroll(rollId, [target.dataset.dieId]).catch(showError);
    }
  });

  expressionInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (room) roomRollButton.click();
    else rollButton.click();
  });

  setRoomStatus('OFFLINE', false);
  setBusy(false);
  refreshFixedHint();
  renderLog();
}

// Mirrors `mustElement` in src/main.ts: the generic forwards to `querySelector` and is
// only used in the return position.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required character-sheet element is missing: ${selector}`);
  return element;
}

function changedDice(previous: NormalizedRollResult, next: NormalizedRollResult): string[] {
  const previousById = new Map(previous.dice.map((die) => [die.id, die]));
  return next.dice.filter((die) => {
    const old = previousById.get(die.id);
    return !old || old.result !== die.result || old.type !== die.type || old.themeId !== die.themeId;
  }).map((die) => die.id);
}

class FixedSequenceRng implements DiceRng {
  private cursor = 0;

  constructor(private readonly values: readonly number[]) {}

  get used(): number {
    return this.cursor;
  }

  get remaining(): number {
    return this.values.length - this.cursor;
  }

  integer(min: number, max: number): number {
    const value = this.values[this.cursor];
    if (value === undefined) {
      throw new Error(`The formula requested result ${this.cursor + 1}, but no predetermined value was supplied`);
    }
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`Predetermined result ${value} is invalid for roll ${this.cursor + 1}; expected ${min}..${max}`);
    }
    this.cursor += 1;
    return value;
  }
}

function parseFixedValues(value: string): number[] {
  const parsed = parseFixedValuesLenient(value);
  if (parsed.some((entry) => !Number.isSafeInteger(entry))) {
    throw new Error('Predetermined results must be integers separated by commas');
  }
  return parsed;
}

function parseFixedValuesLenient(value: string): number[] {
  if (!value.trim()) return [];
  return value
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map((token) => {
      const normalized = token.trim().toLowerCase();
      if (normalized === '+' || normalized === 'plus') return 1;
      if (normalized === '-' || normalized === 'minus') return -1;
      return Number(normalized);
    });
}

function describeFormulaDice(expression: string): string[] {
  const dice: string[] = [];
  const pattern = /(\d*)d(%|f|\d+)/gi;
  for (const match of expression.matchAll(pattern)) {
    const count = Math.min(30, Math.max(1, Number.parseInt(match[1] || '1', 10) || 1));
    const type = match[2].toLowerCase() === 'f'
      ? 'dF'
      : match[2] === '%'
        ? 'd%'
        : `d${match[2]}`;
    for (let index = 0; index < count; index += 1) dice.push(type);
  }
  return dice;
}

function exampleResultsForFormula(expression: string): Array<number | string> {
  return describeFormulaDice(expression).map((type, index) => {
    if (type === 'dF') return index % 3 === 0 ? '+' : index % 3 === 1 ? '0' : '-';
    if (type === 'd%') return 100;
    const sides = Number(type.slice(1));
    return Number.isFinite(sides) ? Math.max(1, sides - (index % Math.min(3, sides))) : 1;
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForPlaygroundPresentation(value: unknown): Promise<void> {
  if (!value || typeof value !== 'object') return;
  const wait = (value as { wait?: unknown }).wait;
  if (typeof wait === 'function') await wait.call(value);
}

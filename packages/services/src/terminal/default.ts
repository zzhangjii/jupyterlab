// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  PageConfig, URLExt
} from '@jupyterlab/coreutils';

import {
  ArrayExt, each, map, toArray
} from '@phosphor/algorithm';

import {
  JSONPrimitive
} from '@phosphor/coreutils';

import {
  ISignal, Signal
} from '@phosphor/signaling';

import {
  ServerConnection
} from '..';

import {
  TerminalSession
} from './terminal';


/**
 * The url for the terminal service.
 */
const TERMINAL_SERVICE_URL = 'api/terminals';


/**
 * An implementation of a terminal interface.
 */
export
class DefaultTerminalSession implements TerminalSession.ISession {
  /**
   * Construct a new terminal session.
   */
  constructor(name: string, options: TerminalSession.IOptions = {}) {
    this._name = name;
    this.serverSettings = options.serverSettings || ServerConnection.makeSettings();
    this._readyPromise = this._initializeSocket();
    this.terminated = new Signal<this, void>(this);
  }

  /**
   * A signal emitted when the session is shut down.
   */
  readonly terminated: Signal<this, void>;

  /**
   * A signal emitted when a message is received from the server.
   */
  get messageReceived(): ISignal<this, TerminalSession.IMessage> {
    return this._messageReceived;
  }

  /**
   * Get the name of the terminal session.
   */
  get name(): string {
    return this._name;
  }

  /**
   * Get the model for the terminal session.
   */
  get model(): TerminalSession.IModel {
    return { name: this._name };
  }

  /**
   * The server settings for the session.
   */
  readonly serverSettings: ServerConnection.ISettings;

  /**
   * Test whether the session is ready.
   */
  get isReady(): boolean {
    return this._isReady;
  }

  /**
   * A promise that fulfills when the session is ready.
   */
  get ready(): Promise<void> {
    return this._readyPromise;
  }

  /**
   * Test whether the session is disposed.
   */
  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * Dispose of the resources held by the session.
   */
  dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    delete Private.running[this._url];
    Signal.clearData(this);
  }

  /**
   * Send a message to the terminal session.
   */
  send(message: TerminalSession.IMessage): void {
    if (this._isDisposed || !message.content) {
      return;
    }

    let msg: JSONPrimitive[] = [message.type];
    msg.push(...message.content);
    let value = JSON.stringify(msg);
    if (this._isReady && this._ws) {
      this._ws.send(value);
      return;
    }
    this.ready.then(() => {
      if (this._ws) {
        this._ws.send(value);
      }
    });
  }

  /**
   * Reconnect to the terminal.
   *
   * @returns A promise that resolves when the terminal has reconnected.
   */
  reconnect(): Promise<void> {
    this._readyPromise = this._initializeSocket();
    return this._readyPromise;
  }

  /**
   * Shut down the terminal session.
   */
  shutdown(): Promise<void> {
    return DefaultTerminalSession.shutdown(this.name, this.serverSettings);
  }

  /**
   * Connect to the websocket.
   */
  private _initializeSocket(): Promise<void> {
    let name = this._name;
    if (this._ws) {
      this._ws.close();
    }
    this._isReady = false;
    let settings = this.serverSettings;
    this._url = Private.getTermUrl(settings.baseUrl, this._name);
    Private.running[this._url] = this;
    let wsUrl = URLExt.join(settings.wsUrl, `terminals/websocket/${name}`);
    let token = this.serverSettings.token;
    if (token) {
      wsUrl = wsUrl + `?token=${token}`;
    }
    this._ws = settings.wsFactory(wsUrl);

    this._ws.onmessage = (event: MessageEvent) => {
      if (this._isDisposed) {
        return;
      }

      let data = JSON.parse(event.data) as JSONPrimitive[];
      this._messageReceived.emit({
        type: data[0] as TerminalSession.MessageType,
        content: data.slice(1)
      });
    };

    return new Promise<void>((resolve, reject) => {
      if (!this._ws) {
        return;
      }
      this._ws.onopen = (event: MessageEvent) => {
        if (this._isDisposed) {
          return;
        }
        this._isReady = true;
        resolve(void 0);
      };
      this._ws.onerror = (event: Event) => {
        if (this._isDisposed) {
          return;
        }
        reject(event);
      };
    });
  }

  private _name: string;
  private _url: string;
  private _ws: WebSocket | null = null;
  private _isDisposed = false;
  private _readyPromise: Promise<void>;
  private _isReady = false;
  private _messageReceived = new Signal<this, TerminalSession.IMessage>(this);
}


/**
 * The static namespace for `DefaultTerminalSession`.
 */
export
namespace DefaultTerminalSession {
  /**
   * Whether the terminal service is available.
   */
  export
  function isAvailable(): boolean {
    let available = String(PageConfig.getOption('terminalsAvailable'));
    return available.toLowerCase() === 'true';
  }

  /**
   * Start a new terminal session.
   *
   * @param options - The session options to use.
   *
   * @returns A promise that resolves with the session instance.
   */
  export
  function startNew(options: TerminalSession.IOptions = {}): Promise<TerminalSession.ISession> {
    if (!TerminalSession.isAvailable()) {
      throw Private.unavailableMsg;
    }
    let serverSettings = options.serverSettings || ServerConnection.makeSettings();
    let request = {
      url: Private.getServiceUrl(serverSettings.baseUrl),
      method: 'POST'
    };
    return ServerConnection.makeRequest(request, serverSettings).then(response => {
      if (response.xhr.status !== 200) {
        throw ServerConnection.makeError(response);
      }
      let name = (response.data as TerminalSession.IModel).name;
      return new DefaultTerminalSession(name, {...options, serverSettings });
    });
  }

  /*
   * Connect to a running session.
   *
   * @param name - The name of the target session.
   *
   * @param options - The session options to use.
   *
   * @returns A promise that resolves with the new session instance.
   *
   * #### Notes
   * If the session was already started via `startNew`, the existing
   * session object is used as the fulfillment value.
   *
   * Otherwise, if `options` are given, we resolve the promise after
   * confirming that the session exists on the server.
   *
   * If the session does not exist on the server, the promise is rejected.
   */
  export
  function connectTo(name: string, options: TerminalSession.IOptions = {}): Promise<TerminalSession.ISession> {
    if (!TerminalSession.isAvailable()) {
      return Promise.reject(Private.unavailableMsg);
    }
    let serverSettings = options.serverSettings || ServerConnection.makeSettings();
    let url = Private.getTermUrl(serverSettings.baseUrl, name);
    if (url in Private.running) {
      return Promise.resolve(Private.running[url]);
    }
    return listRunning(serverSettings).then(models => {
      let index = ArrayExt.findFirstIndex(models, model => {
        return model.name === name;
      });
      if (index !== -1) {
        let session = new DefaultTerminalSession(name, { ...options, serverSettings});
        return Promise.resolve(session);
      }
      return Promise.reject<TerminalSession.ISession>('Could not find session');
    });
  }

  /**
   * List the running terminal sessions.
   *
   * @param settings - The server settings to use.
   *
   * @returns A promise that resolves with the list of running session models.
   */
  export
  function listRunning(settings?: ServerConnection.ISettings): Promise<TerminalSession.IModel[]> {
    if (!TerminalSession.isAvailable()) {
      return Promise.reject(Private.unavailableMsg);
    }
    settings = settings || ServerConnection.makeSettings();
    let url = Private.getServiceUrl(settings.baseUrl);
    let request = {
      url,
      method: 'GET'
    };
    return ServerConnection.makeRequest(request, settings).then(response => {
      if (response.xhr.status !== 200) {
        throw ServerConnection.makeError(response);
      }
      let data = response.data as TerminalSession.IModel[];
      if (!Array.isArray(data)) {
        throw ServerConnection.makeError(response, 'Invalid terminal data');
      }
      // Update the local data store.
      let urls = toArray(map(data, item => {
          return URLExt.join(url, item.name);
      }));
      each(Object.keys(Private.running), runningUrl => {
        if (urls.indexOf(runningUrl) === -1) {
          let session = Private.running[runningUrl];
          session.terminated.emit(void 0);
          session.dispose();
        }
      });
      return data;
    });
  }

  /**
   * Shut down a terminal session by name.
   *
   * @param name - The name of the target session.
   *
   * @param settings - The server settings to use.
   *
   * @returns A promise that resolves when the session is shut down.
   */
  export
  function shutdown(name: string, settings?: ServerConnection.ISettings): Promise<void> {
    if (!TerminalSession.isAvailable()) {
      return Promise.reject(Private.unavailableMsg);
    }
    settings = settings || ServerConnection.makeSettings();
    let url = Private.getTermUrl(settings.baseUrl, name);
    let request = {
      url,
      method: 'DELETE'
    };
    return ServerConnection.makeRequest(request, settings).then(response => {
      if (response.xhr.status !== 204) {
        throw ServerConnection.makeError(response);
      }
      Private.killTerminal(url);
    }).catch(err => {
      if (err.xhr.status === 404) {
        let response = JSON.parse(err.xhr.responseText) as any;
        console.warn(response['message']);
        Private.killTerminal(url);
        return;
      }
      return Promise.reject(err) as Promise<void>;
    });
  }
}


/**
 * A namespace for private data.
 */
namespace Private {
  /**
   * A mapping of running terminals by url.
   */
  export
  const running: { [key: string]: DefaultTerminalSession } = Object.create(null);

  /**
   * A promise returned for when terminals are unavailable.
   */
  export
  const unavailableMsg = 'Terminals Unavailable';

  /**
   * Get the url for a terminal.
   */
  export
  function getTermUrl(baseUrl: string, name: string): string {
    return URLExt.join(baseUrl, TERMINAL_SERVICE_URL, name);
  }

  /**
   * Get the base url.
   */
  export
  function getServiceUrl(baseUrl: string): string {
    return URLExt.join(baseUrl, TERMINAL_SERVICE_URL);
  }

  /**
   * Kill a terminal by url.
   */
  export
  function killTerminal(url: string): void {
    // Update the local data store.
    if (Private.running[url]) {
      let session = Private.running[url];
      session.terminated.emit(void 0);
      session.dispose();
    }
  }
}

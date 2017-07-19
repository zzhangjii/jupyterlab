// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  IIterator
} from '@phosphor/algorithm';

import {
  JSONPrimitive, JSONObject
} from '@phosphor/coreutils';

import {
  IDisposable
} from '@phosphor/disposable';

import {
  ISignal
} from '@phosphor/signaling';

import {
  ServerConnection
} from '..';

import {
  DefaultTerminalSession
} from './default';


/**
 * The namespace for ISession statics.
 */
export
namespace TerminalSession {
  /**
   * An interface for a terminal session.
   */
  export
  interface ISession extends IDisposable {
    /**
     * A signal emitted when the session is shut down.
     */
    terminated: ISignal<ISession, void>;

    /**
     * A signal emitted when a message is received from the server.
     */
    messageReceived: ISignal<ISession, IMessage>;

    /**
     * Get the name of the terminal session.
     */
    readonly name: string;

    /**
     * The model associated with the session.
     */
    readonly model: IModel;

    /**
     * The server settings for the session.
     */
    readonly serverSettings: ServerConnection.ISettings;

    /**
     * Test whether the session is ready.
     */
    readonly isReady: boolean;

    /**
     * A promise that fulfills when the session is initially ready.
     */
    readonly ready: Promise<void>;

    /**
     * Send a message to the terminal session.
     */
    send(message: IMessage): void;

    /**
     * Reconnect to the terminal.
     *
     * @returns A promise that resolves when the terminal has reconnected.
     */
    reconnect(): Promise<void>;

    /**
     * Shut down the terminal session.
     */
    shutdown(): Promise<void>;
  }

  /**
   * Test whether the terminal service is available.
   */
  export
  function isAvailable(): boolean {
    return DefaultTerminalSession.isAvailable();
  }

  /**
   * Start a new terminal session.
   *
   * @param options - The session options to use.
   *
   * @returns A promise that resolves with the session instance.
   */
  export
  function startNew(options?: IOptions): Promise<ISession> {
    return DefaultTerminalSession.startNew(options);
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
  function connectTo(name: string, options?: IOptions): Promise<ISession> {
    return DefaultTerminalSession.connectTo(name, options);
  }

  /**
   * List the running terminal sessions.
   *
   * @param settings - The server settings to use.
   *
   * @returns A promise that resolves with the list of running session models.
   */
  export
  function listRunning(settings?: ServerConnection.ISettings): Promise<IModel[]> {
    return DefaultTerminalSession.listRunning(settings);
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
    return DefaultTerminalSession.shutdown(name, settings);
  }

  /**
   * The options for intializing a terminal session object.
   */
  export
  interface IOptions {
   /**
    * The server settings for the session.
    */
    serverSettings?: ServerConnection.ISettings;
  }

  /**
   * The server model for a terminal session.
   */
  export
  interface IModel extends JSONObject {
    /**
     * The name of the terminal session.
     */
    readonly name: string;
  }

  /**
   * A message from the terminal session.
   */
  export
  interface IMessage {
    /**
     * The type of the message.
     */
    readonly type: MessageType;

    /**
     * The content of the message.
     */
    readonly content?: JSONPrimitive[];
  }

  /**
   * Valid message types for the terminal.
   */
  export
  type MessageType = 'stdout' | 'disconnect' | 'set_size' | 'stdin';

  /**
   * The interface for a terminal manager.
   *
   * #### Notes
   * The manager is responsible for maintaining the state of running
   * terminal sessions.
   */
  export
  interface IManager extends IDisposable {
    /**
     * A signal emitted when the running terminals change.
     */
    runningChanged: ISignal<IManager, IModel[]>;

    /**
     * The server settings for the manager.
     */
    readonly serverSettings: ServerConnection.ISettings;

    /**
     * Test whether the manager is ready.
     */
    readonly isReady: boolean;

    /**
     * A promise that fulfills when the manager is ready.
     */
    readonly ready: Promise<void>;

    /**
     * Whether the terminal service is available.
     */
    isAvailable(): boolean;

    /**
     * Create an iterator over the known running terminals.
     *
     * @returns A new iterator over the running terminals.
     */
    running(): IIterator<IModel>;

    /**
     * Create a new terminal session.
     *
     * @param options - The options used to create the session.
     *
     * @returns A promise that resolves with the terminal instance.
     *
     * #### Notes
     * The manager `serverSettings` will be always be used.
     */
    startNew(options?: IOptions): Promise<ISession>;

    /*
     * Connect to a running session.
     *
     * @param name - The name of the target session.
     *
     * @returns A promise that resolves with the new session instance.
     */
    connectTo(name: string): Promise<ISession>;

    /**
     * Shut down a terminal session by name.
     *
     * @param name - The name of the terminal session.
     *
     * @returns A promise that resolves when the session is shut down.
     */
    shutdown(name: string): Promise<void>;

    /**
     * Force a refresh of the running terminal sessions.
     *
     * @returns A promise that with the list of running sessions.
     *
     * #### Notes
     * This is not typically meant to be called by the user, since the
     * manager maintains its own internal state.
     */
    refreshRunning(): Promise<void>;
  }
}

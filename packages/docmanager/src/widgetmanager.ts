// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  ArrayExt, each, map, find, filter, toArray
} from '@phosphor/algorithm';

import {
  DisposableSet, IDisposable
} from '@phosphor/disposable';

import {
  IMessageHandler, Message, MessageLoop
} from '@phosphor/messaging';

import {
  AttachedProperty
} from '@phosphor/properties';

import {
  ISignal, Signal
} from '@phosphor/signaling';

import {
  Widget
} from '@phosphor/widgets';

import {
  Time
} from '@jupyterlab/coreutils';

import {
  showDialog, Dialog
} from '@jupyterlab/apputils';

import {
  DocumentRegistry
} from '@jupyterlab/docregistry';

import {
  Contents
} from '@jupyterlab/services';


/**
 * The class name added to document widgets.
 */
const DOCUMENT_CLASS = 'jp-Document';


/**
 * A class that maintains the lifecyle of file-backed widgets.
 */
export
class DocumentWidgetManager implements IDisposable {
  /**
   * Construct a new document widget manager.
   */
  constructor(options: DocumentWidgetManager.IOptions) {
    this._registry = options.registry;
  }

  /**
   * A signal emitted when one of the documents is activated.
   */
  get activateRequested(): ISignal<this, string> {
    return this._activateRequested;
  }

  /**
   * Test whether the document widget manager is disposed.
   */
  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * Dispose of the resources used by the widget manager.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._isDisposed = true;
    Signal.disconnectReceiver(this);
  }

  /**
   * Create a widget for a document and handle its lifecycle.
   *
   * @param factory - The widget factory.
   *
   * @param context - The document context object.
   *
   * @returns A widget created by the factory.
   *
   * @throws If the factory is not registered.
   */
  createWidget(factory: DocumentRegistry.WidgetFactory, context: DocumentRegistry.Context): DocumentRegistry.IReadyWidget {
    let widget = factory.createNew(context);
    Private.factoryProperty.set(widget, factory);

    // Handle widget extensions.
    let disposables = new DisposableSet();
    each(this._registry.widgetExtensions(factory.name), extender => {
      disposables.add(extender.createNew(widget, context));
    });
    Private.disposablesProperty.set(widget, disposables);
    widget.disposed.connect(this._onWidgetDisposed, this);

    this.adoptWidget(context, widget);
    context.fileChanged.connect(this._onFileChanged, this);
    context.pathChanged.connect(this._onPathChanged, this);
    context.ready.then(() => {
      this.setCaption(widget);
    });
    return widget;
  }

  /**
   * Install the message hook for the widget and add to list
   * of known widgets.
   *
   * @param context - The document context object.
   *
   * @param widget - The widget to adopt.
   */
  adoptWidget(context: DocumentRegistry.Context, widget: Widget): void {
    let widgets = Private.widgetsProperty.get(context);
    widgets.push(widget);
    MessageLoop.installMessageHook(widget, this);
    widget.addClass(DOCUMENT_CLASS);
    widget.title.closable = true;
    widget.disposed.connect(this._widgetDisposed, this);
    Private.contextProperty.set(widget, context);
  }

  /**
   * See if a widget already exists for the given context and widget name.
   *
   * @param context - The document context object.
   *
   * @returns The found widget, or `undefined`.
   *
   * #### Notes
   * This can be used to use an existing widget instead of opening
   * a new widget.
   */
  findWidget(context: DocumentRegistry.Context, widgetName: string): Widget | undefined {
    let widgets = Private.widgetsProperty.get(context);
    if (!widgets) {
      return undefined;
    }
    return find(widgets, widget => {
      let factory = Private.factoryProperty.get(widget);
      if (!factory) {
        return false;
      }
      return factory.name === widgetName;
    });
  }

  /**
   * Get the document context for a widget.
   *
   * @param widget - The widget of interest.
   *
   * @returns The context associated with the widget, or `undefined`.
   */
  contextForWidget(widget: Widget): DocumentRegistry.Context | undefined {
    return Private.contextProperty.get(widget);
  }

  /**
   * Clone a widget.
   *
   * @param widget - The source widget.
   *
   * @returns A new widget or `undefined`.
   *
   * #### Notes
   *  Uses the same widget factory and context as the source, or throws
   *  if the source widget is not managed by this manager.
   */
  cloneWidget(widget: Widget): Widget | undefined {
    let context = Private.contextProperty.get(widget);
    if (!context) {
      return undefined;
    }
    let factory = Private.factoryProperty.get(widget);
    if (!factory) {
      return undefined;
    }
    let newWidget = this.createWidget(factory, context);
    this.adoptWidget(context, newWidget);
    return widget;
  }

  /**
   * Close the widgets associated with a given context.
   *
   * @param context - The document context object.
   */
  closeWidgets(context: DocumentRegistry.Context): Promise<void> {
    let widgets = Private.widgetsProperty.get(context);
    return Promise.all(
      toArray(map(widgets, widget => this.onClose(widget)))
    ).then(() => undefined);
  }

  /**
   * Filter a message sent to a message handler.
   *
   * @param handler - The target handler of the message.
   *
   * @param msg - The message dispatched to the handler.
   *
   * @returns `false` if the message should be filtered, of `true`
   *   if the message should be dispatched to the handler as normal.
   */
  messageHook(handler: IMessageHandler, msg: Message): boolean {
    switch (msg.type) {
    case 'close-request':
      this.onClose(handler as Widget);
      return false;
    case 'activate-request':
      let context = this.contextForWidget(handler as Widget);
      if (context) {
        this._activateRequested.emit(context.path);
      }
      break;
    default:
      break;
    }
    return true;
  }

  /**
   * Set the caption for widget title.
   *
   * @param widget - The target widget.
   */
  protected setCaption(widget: Widget): void {
    let context = Private.contextProperty.get(widget);
    if (!context) {
      return;
    }
    let model = context.contentsModel;
    if (!model) {
      widget.title.caption = '';
      return;
    }
    context.listCheckpoints().then((checkpoints: Contents.ICheckpointModel[]) => {
      if (widget.isDisposed) {
        return;
      }
      let last = checkpoints[checkpoints.length - 1];
      let checkpoint = last ? Time.format(last.last_modified) : 'None';
      widget.title.caption = (
        `Name: ${model.name}\n` +
        `Path: ${model.path}\n` +
        `Last Saved: ${Time.format(model.last_modified)}\n` +
        `Last Checkpoint: ${checkpoint}`
      );
    });
  }

  /**
   * Handle `'close-request'` messages.
   *
   * @param widget - The target widget.
   *
   * @returns A promise that resolves with whether the widget was closed.
   */
  protected onClose(widget: Widget): Promise<boolean> {
    // Handle dirty state.
    return this._maybeClose(widget).then(result => {
      if (widget.isDisposed) {
        return true;
      }
      if (result) {
        widget.dispose();
      }
      return result;
    }).catch(error => {
      widget.dispose();
      throw error;
    });
  }

  /**
   * Ask the user whether to close an unsaved file.
   */
  private _maybeClose(widget: Widget): Promise<boolean> {
    // Bail if the model is not dirty or other widgets are using the model.)
    let context = Private.contextProperty.get(widget);
    if (!context) {
      return Promise.resolve(true);
    }
    let widgets = Private.widgetsProperty.get(context);
    if (!widgets) {
      return Promise.resolve(true);
    }
    // Filter by whether the factories are read only.
    widgets = toArray(filter(widgets, widget => {
      let factory = Private.factoryProperty.get(widget);
      if (!factory) {
        return false;
      }
      return factory.readOnly === false;
    }));
    let factory = Private.factoryProperty.get(widget);
    if (!factory) {
      return Promise.resolve(true);
    }
    let model = context.model;
    if (!model.dirty || widgets.length > 1 || factory.readOnly) {
      return Promise.resolve(true);
    }
    let fileName = widget.title.label;
    return showDialog({
      title: 'Close without saving?',
      body: `File "${fileName}" has unsaved changes, close without saving?`,
      buttons: [Dialog.cancelButton(), Dialog.warnButton()]
    }).then(value => {
      return value.accept;
    });
  }

  /**
   * Handle the disposal of a widget.
   */
  private _widgetDisposed(widget: Widget): void {
    let context = Private.contextProperty.get(widget);
    if (!context) {
      return;
    }
    let widgets = Private.widgetsProperty.get(context);
    if (!widgets) {
      return;
    }
    // Remove the widget.
    ArrayExt.removeFirstOf(widgets, widget);
    // Dispose of the context if this is the last widget using it.
    if (!widgets.length) {
      context.dispose();
    }
  }

  /**
   * Handle the disposal of a widget.
   */
  private _onWidgetDisposed(widget: Widget): void {
    let disposables = Private.disposablesProperty.get(widget);
    disposables.dispose();
  }

  /**
   * Handle a file changed signal for a context.
   */
  private _onFileChanged(context: DocumentRegistry.Context): void {
    let widgets = Private.widgetsProperty.get(context);
    each(widgets, widget => { this.setCaption(widget); });
  }

  /**
   * Handle a path changed signal for a context.
   */
  private _onPathChanged(context: DocumentRegistry.Context): void {
    let widgets = Private.widgetsProperty.get(context);
    each(widgets, widget => { this.setCaption(widget); });
  }

  private _registry: DocumentRegistry;
  private _activateRequested = new Signal<this, string>(this);
  private _isDisposed = false;
}


/**
 * A namespace for document widget manager statics.
 */
export
namespace DocumentWidgetManager {
  /**
   * The options used to initialize a document widget manager.
   */
  export
  interface IOptions {
    /**
     * A document registry instance.
     */
    registry: DocumentRegistry;
  }
}


/**
 * A private namespace for DocumentManager data.
 */
namespace Private {
  /**
   * A private attached property for a widget context.
   */
  export
  const contextProperty = new AttachedProperty<Widget, DocumentRegistry.Context | undefined>({
    name: 'context',
    create: () => undefined
  });

  /**
   * A private attached property for a widget factory.
   */
  export
  const factoryProperty = new AttachedProperty<Widget, DocumentRegistry.WidgetFactory | undefined> ({
    name: 'factory',
    create: () => undefined
  });

  /**
   * A private attached property for the widgets associated with a context.
   */
  export
  const widgetsProperty = new AttachedProperty<DocumentRegistry.Context, Widget[]>({
    name: 'widgets',
    create: () => []
  });

  /**
   * A private attached property for a widget's disposables.
   */
  export
  const disposablesProperty = new AttachedProperty<Widget, DisposableSet>({
    name: 'disposables',
    create: () => new DisposableSet()
  });
}

// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  URLExt
} from '@jupyterlab/coreutils';

import {
  JSONObject, JSONValue
} from '@phosphor/coreutils';

import {
  ServerConnection
} from '..';


/**
 * The url for the config service.
 */
let SERVICE_CONFIG_URL = 'api/config';


/**
 * A Configurable data section.
 */
export
interface IConfigSection {
  /**
   * The data for this section.
   */
  readonly data: JSONObject;

  /**
   * Modify the stored config values.
   *
   * #### Notes
   * Updates the local data immediately, sends the change to the server,
   * and updates the local data with the response, and fullfils the promise
   * with that data.
   */
  update(newdata: JSONObject): Promise<JSONObject>;

  /**
   * The server settings for the section.
   */
  readonly serverSettings: ServerConnection.ISettings;
}


/**
 * The namespace for ConfigSection statics.
 */
export
namespace ConfigSection {
  /**
   * Create a config section.
   *
   * @returns A Promise that is fulfilled with the config section is loaded.
   */
  export
  function create(options: ConfigSection.IOptions): Promise<IConfigSection> {
    let section = new DefaultConfigSection(options);
    return section.load().then(() => {
      return section;
    });
  }

  /**
   * The options used to create a config section.
   */
  export
  interface IOptions {
    /**
     * The section name.
     */
    name: string;

    /**
     * The optional server settings.
     */
    serverSettings?: ServerConnection.ISettings;
  }
}


/**
 * Implementation of the Configurable data section.
 */
class DefaultConfigSection implements IConfigSection {
  /**
   * Construct a new config section.
   */
  constructor(options: ConfigSection.IOptions) {
    let settings = this.serverSettings = (
      options.serverSettings || ServerConnection.makeSettings()
    );
    this._url = URLExt.join(settings.baseUrl, SERVICE_CONFIG_URL,
                            encodeURIComponent(options.name));
  }

  /**
   * The server settings for the section.
   */
  readonly serverSettings: ServerConnection.ISettings;

  /**
   * Get the data for this section.
   */
  get data(): JSONObject {
    return this._data;
  }

  /**
   * Load the initial data for this section.
   *
   * #### Notes
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/config).
   *
   * The promise is fulfilled on a valid response and rejected otherwise.
   */
  load(): Promise<void> {
    let request = {
      url: this._url,
      method: 'GET'
    };
    return ServerConnection.makeRequest(request, this.serverSettings).then(response => {
      if (response.xhr.status !== 200) {
         throw ServerConnection.makeError(response);
      }
      this._data = response.data as JSONObject;
    });
  }

  /**
   * Modify the stored config values.
   *
   * #### Notes
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/config).
   *
   * The promise is fulfilled on a valid response and rejected otherwise.
   *
   * Updates the local data immediately, sends the change to the server,
   * and updates the local data with the response, and fulfils the promise
   * with that data.
   */
  update(newdata: JSONObject): Promise<JSONObject> {
    this._data = {...this._data, ...newdata};
    let request = {
      url: this._url,
      method: 'PATCH',
      data: JSON.stringify(newdata)
    };
    return ServerConnection.makeRequest(request, this.serverSettings).then(response => {
      if (response.xhr.status !== 200) {
       throw ServerConnection.makeError(response);
      }
      this._data = response.data as JSONObject;
      return this._data;
    });
  }

  private _url = 'unknown';
  private _data: JSONObject;
}


/**
 * Configurable object with defaults.
 */
export
class ConfigWithDefaults {
  /**
   * Create a new config with defaults.
   */
  constructor(options: ConfigWithDefaults.IOptions) {
    this._section = options.section;
    this._defaults = options.defaults || {};
    this._className = options.className || '';
  }

  /**
   * Get data from the config section or fall back to defaults.
   */
  get(key: string): JSONValue {
    let data = this._classData();
    return key in data ? data[key] : this._defaults[key];
  }

  /**
   * Set a config value.
   *
   * #### Notes
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/config).
   *
   * The promise is fulfilled on a valid response and rejected otherwise.
   *
   * Sends the update to the server, and changes our local copy of the data
   * immediately.
   */
  set(key: string, value: JSONValue): Promise<JSONValue> {
     let d: JSONObject = {};
     d[key] = value;
     if (this._className) {
      let d2: JSONObject = {};
      d2[this._className] = d;
      return this._section.update(d2);
    } else {
      return this._section.update(d);
    }
  }

  /**
   * Get data from the Section with our classname, if available.
   *
   * #### Notes
   * If we have no classname, get all of the data in the Section
   */
  private _classData(): JSONObject {
    let data = this._section.data;
    if (this._className && this._className in data) {
      return data[this._className] as JSONObject;
    }
    return data;
  }

  private _section: IConfigSection;
  private _defaults: JSONObject;
  private _className = '';
}


/**
 * A namespace for ConfigWithDefaults statics.
 */
export
namespace ConfigWithDefaults {
  /**
   * The options used to initialize a ConfigWithDefaults object.
   */
  export
  interface IOptions {
    /**
     * The configuration section.
     */
    section: IConfigSection;

    /**
     * The default values.
     */
    defaults?: JSONObject;

    /**
     * The optional classname namespace.
     */
    className?: string;
  }
}

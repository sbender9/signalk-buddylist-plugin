/*
 * Copyright 2019 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const geolib = require('geolib')

module.exports = function(app) {
  var plugin = {};
  var unsubscribes = []
  const notifications = {}

  plugin.start = function(props) {
    (props.buddies || []).forEach(buddy => {
      let command = {
        context: `vessels.${buddy.urn}`,
        subscribe: [{
          path: `navigation.position`,
          policy: 'instant'
        }]
      }

      app.debug('subscribe %j', command)
      
      app.subscriptionmanager.subscribe(command, unsubscribes, subscription_error, delta => {
        delta.updates.forEach(update => {
          update.values.forEach(pv => {
            if ( pv.path == 'navigation.position' ) {
              checkBuddy(buddy.urn, buddy.name, props.alertDistance, pv.value)
            }
          })
        })
      })
    })
  }

  function subscription_error(err)
  {
    console.log("error: " + err)
    app.setProviderError(err.message)
  }
  
  function checkBuddy(context, name, alertDistance, position) {
    const isBuddy = app.getPath(`vessels.${context}.buddy`)
    if ( !isBuddy ) {
      app.debug('found buddy: %s', context) 
      app.handleMessage(plugin.id, {
        context: `vessels.${context}`,
        updates: [{
          values: [{
            path: '',
            value: { buddy: true }
          }]
        }]
      })
    }
    const kname = app.getPath(`/vessels/${context}/name`)
    const myPos = app.getSelfPath('navigation.position.value')
    app.debug('my pos %j', myPos)
    if ( myPos && myPos.latitude && myPos.longitude ) {
      const distance = geolib.getDistance(myPos, position)
      app.debug('%s is %dm away', context, distance)
      if ( distance < alertDistance*1000 ) {
        const sentName = name || kname || context
        const sent = notifications[context]
        app.debug('sent: ' + sent)
        if ( !sent || sent != sentName ) {
          app.debug('send notification for %s', context)
          notifications[context] = sentName
          app.handleMessage(plugin.id, {
            updates: [{
              values: [{
                path: `notifications.buddy.${context}`,
                value: {
                  state: 'alert',
                  method: [ 'visual', 'sound' ],
                  message: `Your buddy ${sentName} is near`
                }
              }]
            }]
          })
        }
      } else if ( notifications[context] ) {
        app.debug('clear notification for %s', context)
        delete notifications[context]
        app.handleMessage(plugin.id, {
          updates: [{
            values: [{
              path: `notifications.buddy.${context}`,
              value: {
                state: 'normal',
                method: [],
                message: `Your buddy ${name || kname || context} is away`
              }
            }]
          }]
        })
      }
    }
  }

  plugin.stop = function() {
    unsubscribes.forEach(f => f())
    unsubscribes = []
  }
  
  plugin.id = "signalk-buddylist-plugin"
  plugin.name = "Buddy List"
  plugin.description = "Provides a buddy list for Signal K Node Server"

  plugin.schema = {
    type: "object",
    properties: {
      buddies: {
        type: "array",
        title: "Buddies",
        items: {
          type: "object",
          required: [ 'urn' ],
          properties: {
            urn: {
              type: 'string',
              title: 'URN',
              description: 'The Signal K urn of the buddy (ex: urn:mrn:imo:mmsi:123456)'
            },
            name: {
              type: 'string',
              title: 'Name',
              description: 'Optional name of the buddy'
            }
          }
        }
      },
      alert: {
        type: 'boolean',
        title: 'Alert',
        description: 'Send a notification when a buddy is near',
        default: true
      },
      alertDistance: {
        type: 'number',
        title: 'Alert Distance',
        description: 'Sent the notification when a buddy is this near (km)',
        default: 1
      }
    }
  }

  return plugin;
}

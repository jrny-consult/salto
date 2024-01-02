/*
*                      Copyright 2024 Salto Labs Ltd.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with
* the License.  You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/

import _ from 'lodash'
import { elements as elementUtils, client as clientUtils } from '@salto-io/adapter-components'
import { getChangeData, isInstanceChange, Change, InstanceElement } from '@salto-io/adapter-api'
import { defaultDeployChange, defaultServiceIdSetter, deployChanges } from '../deployment/standard_deployment'
import { FilterCreator } from '../filter'
import { JSM_DUCKTYPE_SUPPORTED_TYPES } from '../config/api_config'
import { OBJECT_SCHEMA_TYPE, OBJECT_TYPE_TYPE, OBJECT_SCHEMA_STATUS_TYPE, QUEUE_TYPE } from '../constants'
import { getWorkspaceId } from '../workspace_id'

const {
  replaceInstanceTypeForDeploy,
} = elementUtils.ducktype
const ASSETS_SUPPORTED_TYPES = [OBJECT_SCHEMA_TYPE, OBJECT_SCHEMA_STATUS_TYPE, OBJECT_TYPE_TYPE]
const SUPPORTED_TYPES = new Set(Object.keys(JSM_DUCKTYPE_SUPPORTED_TYPES).concat(ASSETS_SUPPORTED_TYPES))

const serviceIdSetterQueue = (
  instance: InstanceElement,
  serviceIdField: string,
  response: clientUtils.ResponseValue
): void => {
  const serviceFieldValue = response?.[serviceIdField]
  if (instance.elemID.typeName === QUEUE_TYPE && _.isNumber(serviceFieldValue)) {
    instance.value[serviceIdField] = serviceFieldValue.toString()
  } else {
    instance.value[serviceIdField] = serviceFieldValue
  }
}

const filterCreator: FilterCreator = ({ config, client }) => ({
  name: 'jsmDeployFilter',
  deploy: async (changes: Change<InstanceElement>[]) => {
    const { jsmApiDefinitions } = config
    if (!config.fetch.enableJSM || jsmApiDefinitions === undefined) {
      return {
        deployResult: { appliedChanges: [], errors: [] },
        leftoverChanges: changes,
      }
    }

    const [jsmTypesChanges, leftoverChanges] = _.partition(
      changes,
      change =>
        SUPPORTED_TYPES.has(getChangeData(change).elemID.typeName)
        && isInstanceChange(change)
    )
    const workspaceId = await getWorkspaceId(client)
    const additionalUrlVars = workspaceId ? { workspaceId } : undefined

    const typeFixedChanges = jsmTypesChanges
      .map(change => ({
        action: change.action,
        data: _.mapValues(change.data, (instance: InstanceElement) =>
          replaceInstanceTypeForDeploy({
            instance,
            config: jsmApiDefinitions,
          })),
      })) as Change<InstanceElement>[]

    const deployResult = await deployChanges(
      typeFixedChanges,
      async change => {
        const typeDefinition = jsmApiDefinitions.types[getChangeData(change).elemID.typeName]
        const deployRequest = typeDefinition.deployRequests ? typeDefinition.deployRequests[change.action] : undefined
        const fieldsToIgnore = deployRequest?.fieldsToIgnore ?? []
        const instance = getChangeData(change)
        await defaultDeployChange({
          change,
          client,
          apiDefinitions: jsmApiDefinitions,
          fieldsToIgnore,
          additionalUrlVars,
          serviceIdSetter: instance.elemID.typeName === QUEUE_TYPE ? serviceIdSetterQueue : defaultServiceIdSetter,
        })
      }
    )
    return { deployResult, leftoverChanges }
  },
})

export default filterCreator

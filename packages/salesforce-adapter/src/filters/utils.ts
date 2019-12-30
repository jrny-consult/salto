import _ from 'lodash'
import { logger } from '@salto/logging'
import { Element, Field, isObjectType, ObjectType, InstanceElement, isInstanceElement,
  isField, Type, BuiltinTypes } from 'adapter-api'
import { API_NAME, CUSTOM_FIELD, LABEL, CUSTOM_OBJECT,
  METADATA_TYPE, NAMESPACE_SEPARATOR } from '../constants'
import { CustomField, JSONBool } from '../client/types'
import { fieldFullName, isCustomObject, metadataType, sfCase, apiName } from '../transformers/transformer'
import SalesforceClient from '../client/client'

const log = logger(module)

export const id = (elem: Element): string => elem.elemID.getFullName()

export const boolValue = (val: JSONBool):
 boolean => val === 'true' || val === true

export const getInstancesOfMetadataType = (elements: Element[], metadataTypeName: string):
 InstanceElement[] =>
  elements.filter(isInstanceElement)
    .filter(element => metadataType(element) === metadataTypeName)

const readSalesforceFields = async (client: SalesforceClient, fieldNames: string[]):
  Promise<Record<string, CustomField>> => (
  _(await client.readMetadata(CUSTOM_FIELD, fieldNames)
    .catch(e => {
      log.error('failed to read fields %o reason: %o', fieldNames, e)
      return []
    }))
    .map(field => [field.fullName, field])
    .fromPairs()
    .value()
)

export const getCustomObjects = (elements: Element[]): ObjectType[] =>
  elements
    .filter(isObjectType)
    .filter(isCustomObject)

// collect Object Type's elemID to api name as we have custom Object Types that are split and
// we need to know the api name to build full field name
export const generateObjectElemID2ApiName = (customObjects: ObjectType[]): Record<string, string> =>
  _(customObjects)
    .filter(obj => obj.annotations[API_NAME])
    .map(obj => [id(obj), obj.annotations[API_NAME]])
    .fromPairs()
    .value()

export const runOnFields = async (elements: Element[], condition: (field: Field) => boolean,
  runOnField: (field: Field, salesforceField: CustomField) => void, client: SalesforceClient):
  Promise<void> => {
  const getSalesforceFieldFullName = (field: Field,
    objectElemID2ApiName: Record<string, string>): string =>
    fieldFullName(objectElemID2ApiName[field.parentID.getFullName()], field)

  const customObjects = getCustomObjects(elements)
  const objectElemID2ApiName = generateObjectElemID2ApiName(customObjects)
  const fields = _(customObjects)
    .map(obj => Object.values(obj.fields))
    .flatten()
    .filter(condition)
    .value()
  const salesforceFieldNames = fields
    .map(f => getSalesforceFieldFullName(f, objectElemID2ApiName))
  const name2Field = await readSalesforceFields(client, salesforceFieldNames)
  fields.forEach(field => {
    const salesforceField = name2Field[getSalesforceFieldFullName(field, objectElemID2ApiName)]
    runOnField(field, salesforceField)
  })
}

export const removeFieldsFromInstanceAndType = (elements: Element[], fieldNamesToDelete: string[],
  metadataTypeName: string): void => {
  getInstancesOfMetadataType(elements, metadataTypeName)
    .forEach(instance => fieldNamesToDelete
      .forEach(fieldNameToDelete => delete instance.value[fieldNameToDelete]))
  elements.filter(isObjectType)
    .filter(element => metadataType(element) === metadataTypeName)
    .forEach(elementType => fieldNamesToDelete
      .forEach(fieldNameToDelete => delete elementType.fields[fieldNameToDelete]))
}

export const addLabel = (elem: Type | Field, label?: string): void => {
  const name = isField(elem) ? elem.name : elem.elemID.name
  const { annotations } = elem
  if (!annotations[LABEL]) {
    annotations[LABEL] = label || sfCase(name)
    log.debug(`added LABEL=${annotations[LABEL]} to ${name}`)
  }
}

export const addApiName = (elem: Type | Field, name: string): void => {
  if (!elem.annotations[API_NAME]) {
    elem.annotations[API_NAME] = name
    log.debug(`added API_NAME=${name} to ${isField(elem) ? elem.name : elem.elemID.name}`)
  }
  if (!isField(elem) && !elem.annotationTypes[API_NAME]) {
    elem.annotationTypes[API_NAME] = BuiltinTypes.SERVICE_ID
  }
}

export const addMetadataType = (elem: ObjectType,
  metadataTypeValue = CUSTOM_OBJECT): void => {
  const { annotations, annotationTypes } = elem
  if (!annotationTypes[METADATA_TYPE]) {
    annotationTypes[METADATA_TYPE] = BuiltinTypes.SERVICE_ID
  }
  if (!annotations[METADATA_TYPE]) {
    annotations[METADATA_TYPE] = metadataTypeValue
    log.debug(`added METADATA_TYPE=${sfCase(metadataTypeValue)} to ${id(elem)}`)
  }
}

export const hasNamespace = (customElement: Field | ObjectType): boolean =>
  apiName(customElement).split(NAMESPACE_SEPARATOR).length === 3

export const getNamespace = (customElement: Field | ObjectType): string =>
  apiName(customElement).split(NAMESPACE_SEPARATOR)[0]

/**
 * Flattens a nested object into a single-level object.
 * @param {Object} obj - The object to be flattened.
 * @param {string} [parent=''] - The parent key to be prepended to the flattened keys.
 * @param {Object} [res={}] - The resulting flattened object.
 * @returns {Object} - The flattened object.
 */
const flattenObject = (obj, parent = "", res = {}) => {
    for (let key in obj) {
        let propName = parent ? parent + "_" + key : key;
        if (obj[key] !== null && typeof obj[key] === "object") {
            flattenObject(obj[key], propName, res);
        } else {
            res[propName] = obj[key];
        }
    }
    return res;
};

/**
 * Picks specific properties from an object based on the provided keys.
 * @param {object} obj - The object to pick properties from.
 * @param {string[]} allowedKeys - An array of keys representing the properties to pick.
 * @returns {object} - A new object containing only the picked properties.
 */
function deepPick(obj, allowedKeys) {
    let newObj = {};
    allowedKeys.forEach((key) => {
        let keys = key.split(".");
        let lastKey = keys.pop();
        let lastObj = keys.reduce((res, key) => res[key] || {}, obj);
        if (lastObj && Object.prototype.hasOwnProperty.call(lastObj, lastKey)) {
            newObj[key] = lastObj[lastKey];
        } else {
            newObj[key] = null;
        }
    });
    return newObj;
}

/**
 * Adds a key-value pair to an object at the specified index.
 *
 * @param {Object} obj - The object to add the key-value pair to.
 * @param {string} key - The key of the new key-value pair.
 * @param {*} value - The value of the new key-value pair.
 * @param {number} index - The index at which to insert the new key-value pair.
 * @returns {Object} - The modified object with the new key-value pair added.
 */
const addKeyValue = (obj, key, value, index) => {
    // Convert the object to an array of key-value pairs
    let array = Object.entries(obj);

    // Insert the new key-value pair at the specified index
    array.splice(index, 0, [key, value]);

    // Convert the array back to an object
    let result = {};
    array.forEach(([key, value]) => (result[key] = value));

    return result;
};

/**
 * trim all string values in the object
 *
 * @param {Object} obj - The object to be trim.
 * @returns {Object} - The trimmed object.
 */
const deepTrim = (obj) => {
    if (obj && typeof obj === "object") {
        Object.keys(obj).map((key) => {
            if (typeof obj[key] === "object") {
                deepTrim(obj[key]);
            } else if (typeof obj[key] === "string") {
                obj[key] = obj[key].trim();
            }
        });
    }
    return obj;
};

export default {
    flattenObject,
    deepPick,
    addKeyValue,
    deepTrim,
};


const { isWithinInterval } = require('date-fns');

console.log('Testing date-fns and localeCompare behavior...');

try {
    const start = new Date(0);
    const end = new Date();
    const invalidDate = new Date('invalid-date-string');
    console.log('Invalid Date object:', invalidDate);

    console.log('Calling isWithinInterval with Invalid Date...');
    const result = isWithinInterval(invalidDate, { start, end });
    console.log('isWithinInterval result:', result);
} catch (e) {
    console.log('isWithinInterval THREW error:', e.message);
}

try {
    const invalidDate2 = new Date(undefined as any); // mimics new Date(task.date) where task.date is undefined
    console.log('Undefined Date object:', invalidDate2);
    console.log('Calling isWithinInterval with Undefined Date...');
    const result2 = isWithinInterval(invalidDate2, { start: new Date(0), end: new Date() });
    console.log('isWithinInterval result (undefined):', result2);
} catch (e) {
    console.log('isWithinInterval THREW error (undefined):', e.message);
}

try {
    const str: string | undefined = undefined;
    console.log('Testing localeCompare on undefined...');
    // @ts-ignore
    str.localeCompare('something');
} catch (e) {
    console.log('localeCompare THREW error:', e.message);
}

try {
    const str: any = null;
    console.log('Testing localeCompare on null...');
    str.localeCompare('something');
} catch (e) {
    console.log('localeCompare THREW error:', e.message);
}

console.log('Done.');

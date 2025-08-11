// test-jimp.js
try {
  const jimpModule = require('jimp');
  console.log('The jimp module is:', jimpModule);

  // Let's also check its properties
  console.log('\nProperties on the module:');
  for (const key in jimpModule) {
    console.log(`- ${key}:`, typeof jimpModule[key]);
  }

} catch (error) {
  console.error('Failed to require "jimp":', error);
}


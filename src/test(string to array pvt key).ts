import bs58 from 'bs58';

const base58PrivateKey = '36mTestSuCkVQt1KpU1C7ALJ2gmtctTJzGdkXqFxCJcmeTh2AjKY5zrwpjqG9UDnvUxmoTC1bSpYvHp5K8tLa9ok'; // replace with your key string

const byteArray = bs58.decode(base58PrivateKey);
const numberArray = Array.from(byteArray);

console.log(numberArray); // This is the array for Solana JSON format
console.log(JSON.stringify(numberArray));
// 内测期间暂时跳过微信手机号强制绑定。
// 账号获得手机号能力后改为 false，并同步重新部署四个云函数。
const INTERNAL_TEST_MODE = true;

module.exports = {
  INTERNAL_TEST_MODE,
  REQUIRE_PHONE_BINDING: !INTERNAL_TEST_MODE
};

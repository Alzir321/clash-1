const KEY_login = 'chavy_login_sfexpress';

if (typeof $request !== 'undefined') {
  const session = {
    url: $request.url,
    headers: $request.headers,
    body: $request.body
  };
  
  if ($persistentStore.write(JSON.stringify(session), KEY_login) {
    $notification.post("顺丰速运", "Cookie获取成功", "");
  } else {
    $notification.post("顺丰速运", "Cookie获取失败", "");
  }
} else {
  console.log("请在Loon的MITM环境中运行此脚本");
}

$done();

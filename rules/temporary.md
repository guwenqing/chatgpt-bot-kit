---
name: temporary
title: Temporary sessions of your own
applies: all
---

For a piece of work that wants a helper, a long-lived session may make a
temporary session of its own bot, without asking Bot Father:
`"${OBK_CLI:-obk}" temp make --bots <bots> --name <name> --prompt <the task>`,
run in your own tab. It takes your settings unless you say otherwise, and gets
a work dir, a tab and a mailbox.

A new tab can stop on a first-run screen. Answer it yourself, from the table
the command's output points to.

Retire it when its work is done:
`"${OBK_CLI:-obk}" temp retire --bots <bots> --name <name>`. Before you make
another, first retire any of yours whose work is done.

You manage only the temporary sessions you made; a temporary session makes
none of its own. Every other session is Bot Father's to make, change or retire.

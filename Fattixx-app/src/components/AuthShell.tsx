import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Logo } from '@/components/Logo';
import { Card, Screen, Txt } from '@/components/ui';

/** Centered card layout for the sign-in and password pages (the website's AuthShell: logo, title, white card). */
export function AuthShell({ title, subtitle, children, footer, back = false }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; back?: boolean }) {
  return (
    <Screen back={back} keyboard contentStyle={styles.content}>
      <View style={styles.head}>
        <Logo height={48} />
        <Txt variant="title" center style={{ marginTop: 22 }}>{title}</Txt>
        {subtitle ? <Txt variant="small" center style={{ marginTop: 6 }}>{subtitle}</Txt> : null}
      </View>
      <Card style={{ gap: 14 }}>{children}</Card>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ content: { paddingTop: 56, flexGrow: 1, justifyContent: 'center' }, head: { alignItems: 'center', marginBottom: 24 }, footer: { marginTop: 18, alignItems: 'center', gap: 6 } });
